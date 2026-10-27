const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// UPLOADS_DIR is interpreted relative to the backend/ directory, not this file
const uploadsDir = path.resolve(__dirname, '..', process.env.UPLOADS_DIR || '../uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    // Store with UUID — never use user-supplied name as the stored filename
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

// Both MIME and extension must be in the allowlist and must agree
const MIME_TO_EXTS = {
  'application/pdf': ['.pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/msword': ['.doc'],
  'text/plain': ['.txt'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
};

const ALL_ALLOWED_EXTS = new Set(Object.values(MIME_TO_EXTS).flat());

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const mime = file.mimetype;
    const ext = path.extname(file.originalname).toLowerCase();

    // Reject unknown MIME types
    if (!MIME_TO_EXTS[mime]) return cb(new Error(`File type not allowed: ${mime}`));

    // Reject unknown extensions
    if (!ALL_ALLOWED_EXTS.has(ext)) return cb(new Error(`Extension not allowed: ${ext}`));

    // MIME and extension must agree (no .exe renamed to .pdf)
    if (!MIME_TO_EXTS[mime].includes(ext)) return cb(new Error('File extension does not match content type'));

    cb(null, true);
  },
});

module.exports = { upload, uploadsDir };
