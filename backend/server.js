require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Security headers first
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-origin' },
  contentSecurityPolicy: false, // API server — CSP handled by nginx for frontend
}));

app.use(cors({
  origin: process.env.FRONTEND_URL || 'https://app.cs.unlv.edu',
  credentials: true,
}));

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

// Routes
const authRoutes = require('./routes/auth');
const ticketRoutes = require('./routes/tickets');
const userRoutes = require('./routes/users');
const notifRoutes = require('./routes/notifications');
const commentRoutes = require('./routes/comments');
const attachmentRoutes = require('./routes/attachments');

app.use('/api/auth', authRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/tickets/:ticketId/comments', commentRoutes);
app.use('/api/tickets/:ticketId/attachments', attachmentRoutes);
app.use('/api/users', userRoutes);
app.use('/api/notifications', notifRoutes);

// Serve uploaded files (auth required — files are outside web root)
const { uploadsDir } = require('./middleware/upload');
const { requireAuth } = require('./middleware/auth');
app.use('/api/files', requireAuth, express.static(uploadsDir));

// Health check — no server time exposed
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[server] Bylaws Tracker API running on port ${PORT}`);
});
