require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: process.env.FRONTEND_URL || 'https://app.cs.unlv.edu',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// Serve uploaded files (authenticated via query token for inline preview)
const { uploadsDir } = require('./middleware/upload');
const { requireAuth } = require('./middleware/auth');
app.use('/api/files', requireAuth, express.static(uploadsDir));

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[server] Bylaws Tracker API running on port ${PORT}`);
});
