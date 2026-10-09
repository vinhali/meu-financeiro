import 'express-async-errors';
import express, { NextFunction, Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import path from 'path';
import authRouter from './routes/auth';
import scenariosRouter from './routes/scenarios';
import openFinanceRouter from './routes/openfinance';
import { assertAuthConfig, requireAuth, requireSameOrigin } from './auth';
import { initDatabase } from './db';
import { startOpenFinanceScheduler } from './openfinance/scheduler';
import { startAlerts } from './alerts/engine';
import alertsRouter from './routes/alerts';

assertAuthConfig();

const app = express();
app.disable('x-powered-by');
// Atrás de um único proxy reverso (nginx): usa X-Forwarded-For para o IP real.
app.set('trust proxy', 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        // Só faz sentido atrás de HTTPS; em dev (HTTP) quebraria o carregamento.
        upgradeInsecureRequests: process.env.COOKIE_SECURE === 'true' ? [] : null,
      },
    },
    strictTransportSecurity: process.env.COOKIE_SECURE === 'true',
  }),
);
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use('/api', requireSameOrigin);
app.use('/api/auth', authRouter);
app.use('/api/scenarios', requireAuth, scenariosRouter);
app.use('/api/openfinance', requireAuth, openFinanceRouter);
app.use('/api/alerts', requireAuth, alertsRouter);

app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    res.status(404).json({ error: 'Não encontrado' });
    return;
  }
  next();
});

// Frontend estático (build do client/ copiado para /app/public no Dockerfile)
const clientDist = path.join(__dirname, '..', '..', 'public');
// Os arquivos em /assets têm o hash do conteúdo no nome: o navegador pode guardá-los para sempre.
// O index.html é sempre revalidado, para que um deploy novo apareça na hora.
app.use(
  express.static(clientDist, {
    index: false,
    setHeaders: (res, file) => {
      res.setHeader('Cache-Control', /[\\/]assets[\\/]/.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  }),
);
app.get('*', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(clientDist, 'index.html'));
});

// Erros de rota (inclusive rejeições em handlers async) viram 500 em vez de derrubar o processo.
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
    res.status(err.status || 400).json({ error: 'Requisição inválida' });
    return;
  }
  console.error(`[erro] ${req.method} ${req.path}:`, err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Erro interno' });
});

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
initDatabase()
  .then(() => {
    app.listen(port, () => {
      console.log(`Meu financeiro server ouvindo na porta ${port}`);
    });
    startOpenFinanceScheduler();
    startAlerts();
  })
  .catch((err) => {
    console.error('Falha ao inicializar o banco:', err);
    process.exit(1);
  });
