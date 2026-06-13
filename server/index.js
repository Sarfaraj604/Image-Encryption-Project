const express = require('express');
const cors = require('cors');
const multer = require('multer');
const crypto = require('crypto');
const mongoose = require('mongoose');
const path = require('path');
const dotenv = require('dotenv');

const envPath = path.join(__dirname, '.env');
const exampleEnvPath = path.join(__dirname, '.env.example');
const envResult = dotenv.config({ path: envPath });
if (envResult.error) {
  console.warn('.env file not found. Falling back to .env.example for MongoDB connection.');
  dotenv.config({ path: exampleEnvPath });
}

const FileMetadata = require('./models/FileMetadata');
const Message = require('./models/Message');

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;

const SALT_SIZE = 16;
const IV_SIZE = 16;
const KEY_SIZE = 32;
const PBKDF2_ITERATIONS = 100000;
const ALGORITHM = 'aes-256-cbc';

async function connectDatabase() {
  if (!MONGO_URI) {
    console.warn('MONGO_URI is not set. Metadata storage will be skipped.');
    return;
  }

  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB');
  } catch (error) {
    console.error('MongoDB connection failed:', error.message);
  }
}

function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_SIZE, 'sha256');
}

function encryptBuffer(buffer, password) {
  const salt = crypto.randomBytes(SALT_SIZE);
  const iv = crypto.randomBytes(IV_SIZE);
  const key = deriveKey(password, salt);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return Buffer.concat([salt, iv, encrypted]);
}

function decryptBuffer(buffer, password) {
  if (buffer.length < SALT_SIZE + IV_SIZE) {
    throw new Error('Encrypted file is corrupted or invalid.');
  }

  const salt = buffer.slice(0, SALT_SIZE);
  const iv = buffer.slice(SALT_SIZE, SALT_SIZE + IV_SIZE);
  const ciphertext = buffer.slice(SALT_SIZE + IV_SIZE);
  const key = deriveKey(password, salt);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

app.post('/api/encrypt', upload.single('image'), async (req, res) => {
  try {
    const { password } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ message: 'Image file is required.' });
    }
    if (!password || password.length < 4) {
      return res.status(400).json({ message: 'A password of at least 4 characters is required.' });
    }

    const encryptedBuffer = encryptBuffer(file.buffer, password);

    await FileMetadata.create({
      fileName: file.originalname,
      operation: 'encrypt',
      mimeType: file.mimetype,
      createdAt: new Date(),
    }).catch(() => {});

    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${path.parse(file.originalname).name}.enc"`,
    });
    res.send(encryptedBuffer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Encryption failed.', error: error.message });
  }
});

app.post('/api/decrypt', upload.single('encryptedFile'), async (req, res) => {
  try {
    const { password } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ message: 'Encrypted file is required.' });
    }
    if (!password || password.length < 4) {
      return res.status(400).json({ message: 'A password of at least 4 characters is required.' });
    }

    const decryptedBuffer = decryptBuffer(file.buffer, password);

    await FileMetadata.create({
      fileName: file.originalname,
      operation: 'decrypt',
      mimeType: file.mimetype,
      createdAt: new Date(),
    }).catch(() => {});

    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${path.parse(file.originalname).name}_decrypted.png"`,
    });
    res.send(decryptedBuffer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Decryption failed.', error: error.message });
  }
});

app.post('/api/messages/send', upload.single('image'), async (req, res) => {
  try {
    const { sender, receiver, password } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ message: 'Image file is required.' });
    }
    if (!sender || !receiver) {
      return res.status(400).json({ message: 'Sender and receiver are required.' });
    }
    if (!password || password.length < 4) {
      return res.status(400).json({ message: 'A password of at least 4 characters is required.' });
    }

    const encryptedBuffer = encryptBuffer(file.buffer, password);

    const message = await Message.create({
      sender,
      receiver,
      originalName: file.originalname,
      mimeType: file.mimetype,
      encryptedData: encryptedBuffer,
      createdAt: new Date(),
      isRead: false,
    });

    await FileMetadata.create({
      fileName: file.originalname,
      operation: 'encrypt',
      mimeType: file.mimetype,
      createdAt: new Date(),
    }).catch(() => {});

    res.json({ message: 'Encrypted message sent successfully.', messageId: message._id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to send encrypted message.', error: error.message });
  }
});

app.get('/api/messages/inbox', async (req, res) => {
  try {
    const { receiver } = req.query;
    if (!receiver) {
      return res.status(400).json({ message: 'Receiver is required.' });
    }

    const messages = await Message.find({ receiver })
      .sort({ createdAt: -1 })
      .select('sender originalName createdAt isRead');

    res.json({ messages });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to retrieve inbox messages.', error: error.message });
  }
});

app.post('/api/messages/:messageId/decrypt', async (req, res) => {
  try {
    const { messageId } = req.params;
    const { password } = req.body;

    if (!password || password.length < 4) {
      return res.status(400).json({ message: 'A password of at least 4 characters is required.' });
    }

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ message: 'Message not found.' });
    }

    const decryptedBuffer = decryptBuffer(message.encryptedData, password);
    message.isRead = true;
    await message.save();

    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${path.parse(message.originalName).name}_decrypted${path.extname(message.originalName) || '.png'}"`,
    });
    res.send(decryptedBuffer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Decryption failed.', error: error.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

connectDatabase().then(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
});
