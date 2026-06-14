const express = require('express');
const cors = require('cors');
const multer = require('multer');
const crypto = require('crypto');
const mongoose = require('mongoose');
const path = require('path');
const dotenv = require('dotenv');
const Jimp = require('jimp');

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
app.use(cors({ origin: true, methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.options('*', cors());
app.use(express.json());

const http = require('http');
const { Server } = require('socket.io');
let io; // initialized after server created

const upload = multer({ storage: multer.memoryStorage() });

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;

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

function gfMultiply(a, b) {
  let product = 0;
  for (let i = 0; i < 8; i++) {
    if (b & 1) {
      product ^= a;
    }
    const hiBit = a & 0x80;
    a = (a << 1) & 0xff;
    if (hiBit) {
      a ^= 0x1b;
    }
    b >>= 1;
  }
  return product;
}

function gfInverse(byte) {
  if (byte === 0) {
    return 0;
  }
  for (let candidate = 1; candidate < 256; candidate++) {
    if (gfMultiply(byte, candidate) === 1) {
      return candidate;
    }
  }
  return 0;
}

function affineTransform(value) {
  let result = 0;
  for (let i = 0; i < 8; i++) {
    const bit = ((value >> i) & 1) ^
      ((value >> ((i + 4) % 8)) & 1) ^
      ((value >> ((i + 5) % 8)) & 1) ^
      ((value >> ((i + 6) % 8)) & 1) ^
      ((value >> ((i + 7) % 8)) & 1) ^
      ((0x63 >> i) & 1);
    result |= bit << i;
  }
  return result;
}

function buildAesSBox() {
  const sbox = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const inv = gfInverse(i);
    sbox[i] = affineTransform(inv);
  }
  return sbox;
}

function buildInverseSBox(sbox) {
  const invSbox = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    invSbox[sbox[i]] = i;
  }
  return invSbox;
}

function deriveChaoticSeed(password) {
  const hash = crypto.createHash('sha256').update(password).digest();
  const value = hash.readUInt32BE(0) / 0xffffffff;
  return 0.1 + value * 0.8;
}

function buildPermutation(length, seed) {
  const items = new Array(length);
  let x = seed;
  items[0] = { value: x, index: 0 };
  for (let i = 1; i < length; i++) {
    x = 3.99 * x * (1 - x);
    items[i] = { value: x, index: i };
  }
  items.sort((a, b) => a.value - b.value);
  return items.map((item) => item.index);
}

function extractGrayscalePixels(image) {
  const { width, height, data } = image.bitmap;
  const pixels = new Uint8Array(width * height);
  let writeIndex = 0;
  for (let readIndex = 0; readIndex < data.length; readIndex += 4) {
    pixels[writeIndex++] = data[readIndex];
  }
  return { pixels, width, height };
}

async function createImageFromPixels(pixels, width, height) {
  const image = await Jimp.create(width, height);
  let writeIndex = 0;
  for (let i = 0; i < pixels.length; i++) {
    const value = pixels[i];
    image.bitmap.data[writeIndex++] = value;
    image.bitmap.data[writeIndex++] = value;
    image.bitmap.data[writeIndex++] = value;
    image.bitmap.data[writeIndex++] = 255;
  }
  return image;
}

const AES_SBOX = buildAesSBox();
const AES_INV_SBOX = buildInverseSBox(AES_SBOX);

async function encryptImageBuffer(buffer, password) {
  const image = await Jimp.read(buffer);
  image.grayscale();
  const { pixels, width, height } = extractGrayscalePixels(image);

  const substituted = new Uint8Array(pixels.length);
  for (let i = 0; i < pixels.length; i++) {
    substituted[i] = AES_SBOX[pixels[i]];
  }

  const permutation = buildPermutation(pixels.length, deriveChaoticSeed(password));
  const permuted = new Uint8Array(pixels.length);
  for (let i = 0; i < pixels.length; i++) {
    permuted[i] = substituted[permutation[i]];
  }

  const encryptedImage = await createImageFromPixels(permuted, width, height);
  return encryptedImage.getBufferAsync(Jimp.MIME_PNG);
}

async function decryptImageBuffer(buffer, password) {
  const image = await Jimp.read(buffer);
  const { pixels, width, height } = extractGrayscalePixels(image);

  const permutation = buildPermutation(pixels.length, deriveChaoticSeed(password));
  const recoveredSub = new Uint8Array(pixels.length);
  for (let i = 0; i < pixels.length; i++) {
    recoveredSub[permutation[i]] = pixels[i];
  }

  const recovered = new Uint8Array(pixels.length);
  for (let i = 0; i < pixels.length; i++) {
    recovered[i] = AES_INV_SBOX[recoveredSub[i]];
  }

  const decryptedImage = await createImageFromPixels(recovered, width, height);
  return decryptedImage.getBufferAsync(Jimp.MIME_PNG);
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

    const encryptedBuffer = await encryptImageBuffer(file.buffer, password);

    await FileMetadata.create({
      fileName: file.originalname,
      operation: 'encrypt',
      mimeType: file.mimetype,
      createdAt: new Date(),
    }).catch(() => {});

    res.set({
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="${path.parse(file.originalname).name}_encrypted.png"`,
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

    const decryptedBuffer = await decryptImageBuffer(file.buffer, password);

    await FileMetadata.create({
      fileName: file.originalname,
      operation: 'decrypt',
      mimeType: file.mimetype,
      createdAt: new Date(),
    }).catch(() => {});

    res.set({
      'Content-Type': 'image/png',
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

    const encryptedBuffer = await encryptImageBuffer(file.buffer, password);

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

    // Emit real-time notification to receiver if socket.io is available
    try {
      if (io) {
        io.to(receiver).emit('new_message', {
          _id: message._id,
          sender,
          originalName: message.originalName,
          createdAt: message.createdAt,
        });
      }
    } catch (e) {
      console.warn('Failed to emit socket event', e.message);
    }

    res.json({ message: 'Encrypted message sent successfully.', messageId: message._id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to send encrypted message.', error: error.message });
  }
});

app.get('/api/messages/:messageId/encrypted', async (req, res) => {
  try {
    const { messageId } = req.params;
    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ message: 'Message not found.' });
    }
    res.set({
      'Content-Type': 'image/png',
      'Content-Disposition': `inline; filename="${path.parse(message.originalName).name}_encrypted.png"`,
    });
    res.send(message.encryptedData);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to load encrypted preview.', error: error.message });
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

    const decryptedBuffer = await decryptImageBuffer(message.encryptedData, password);
    message.isRead = true;
    await message.save();

    res.set({
      'Content-Type': 'image/png',
      'Content-Disposition': `inline; filename="${path.parse(message.originalName).name}_decrypted${path.extname(message.originalName) || '.png'}"`,
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
  const server = http.createServer(app);
  io = new Server(server, {
    path: '/socket.io',
    cors: {
      origin: true,
      methods: ['GET', 'POST', 'OPTIONS'],
      credentials: true,
    },
  });

  io.on('connection', (socket) => {
    console.log('Socket connected:', socket.id);
    socket.on('identify', (username) => {
      if (username) {
        socket.join(username);
        console.log('Socket', socket.id, 'joined', username);
      }
    });
    socket.on('disconnect', () => {
      // no-op
    });
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
});
