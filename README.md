# MERN AES Image Encryption / Decryption

A full-stack MERN application that lets a user encrypt an image with AES and decrypt it later using the same password.

## Project Structure
- `server/` - Express backend with MongoDB metadata logging and AES encryption/decryption endpoints.
- `client/` - React frontend built with Vite providing an image upload UI.

## Features
- Send encrypted image messages between different users.
- Receiver inbox with "New" message badges and unread count.
- AES-256-CBC encryption using a shared password or key.
- Decrypt messages directly from the browser and download the restored image.
- MongoDB persists encrypted messages and unread status.

## Setup
1. Install root dependencies and workspace packages:

```bash
cd "c:\Users\sarfa\Downloads\Image Encryption Project"
npm install
```

2. Configure the backend environment:

```bash
cd server
copy .env.example .env
```

3. Edit `server/.env` if necessary. Example values:

```
PORT=5000
MONGO_URI=mongodb://localhost:27017/imageEncryptionDB
```

4. Start MongoDB locally or use a hosted MongoDB connection.

## Run the app

Start the backend:

```bash
cd server
npm run dev
```

Then start the frontend locally:

```bash
cd ../client
npm run dev
```

Open the URL shown by Vite (typically `http://localhost:3000`).

## Production deployment

When deploying the frontend to AWS S3, the static site can no longer use the Vite `/api` proxy. Set the backend URL in the frontend build with:

```bash
cd client
copy .env.example .env
```

Then edit `client/.env` and set:

```text
VITE_API_BASE_URL=https://your-ec2-backend-host:5000
```

Build the client and deploy the generated `dist/` folder to S3.

## Usage
1. Choose a sender and a receiver.
2. Upload an image, enter a secret password, and send the encrypted message.
3. On the receiver side, select the receiver user and refresh the inbox.
4. New messages appear with a "New" badge.
5. Select a message, enter the shared password, and download the decrypted image.

## Notes
- The app treats sender and receiver as different users for secure message sharing.
- The shared password must match between send and receive.
- Messages are stored encrypted in MongoDB until decrypted.
- Use a secure channel to share the password between sender and receiver.
