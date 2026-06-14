import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

const users = ['Alice', 'Bob', 'Charlie'];
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const SENDER_ENCRYPTED_PLACEHOLDER = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <filter id="noise">
    <feTurbulence type="fractalNoise" baseFrequency="0.95" numOctaves="2" stitchTiles="stitch" />
    <feColorMatrix type="saturate" values="0" />
  </filter>
  <rect width="100%" height="100%" fill="#1f2937" filter="url(#noise)" />
</svg>
`)} `;
const RECEIVER_ENCRYPTED_PLACEHOLDER = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <filter id="noise">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
    <feColorMatrix type="saturate" values="0" />
  </filter>
  <rect width="100%" height="100%" fill="#111827" filter="url(#noise)" />
</svg>
`)} `;

function getApiUrl(endpoint) {
  return API_BASE_URL ? `${API_BASE_URL}${endpoint}` : endpoint;
}

function App() {
  const [currentUser, setCurrentUser] = useState(users[0]);
  const [sender, setSender] = useState(users[0]);
  const [receiver, setReceiver] = useState(users[1]);
  const [mode, setMode] = useState('send'); // 'send' or 'receive'
  const [signedInUser, setSignedInUser] = useState(users[0]);
  const [imageFile, setImageFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [encryptedPreviewUrl, setEncryptedPreviewUrl] = useState(null);
  const [decryptedPreviewUrl, setDecryptedPreviewUrl] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sendPassword, setSendPassword] = useState('');
  const [decryptPassword, setDecryptPassword] = useState('');
  const [status, setStatus] = useState('Ready to send or receive secure image messages.');
  const [inbox, setInbox] = useState([]);
  const [selectedMessage, setSelectedMessage] = useState(null);

  useEffect(() => {
    if (mode === 'receive') {
      fetchInbox(signedInUser);
    }
  }, [signedInUser, mode]);

  useEffect(() => {
    if (!selectedMessage || mode === 'receive') {
      return;
    }

    let active = true;
    let revokeUrl = null;

    async function loadEncryptedPreview() {
      setStatus('Loading encrypted preview...');
      try {
        const response = await fetch(getApiUrl(`/api/messages/${selectedMessage._id}/encrypted`));
        if (!response.ok) {
          throw new Error('Unable to load encrypted preview.');
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        revokeUrl = url;
        if (!active) {
          URL.revokeObjectURL(url);
          return;
        }
        setEncryptedPreviewSafe(url);
        setPreviewOpen(true);
        setStatus('Encrypted preview loaded.');
      } catch (error) {
        if (active) {
          setEncryptedPreviewUrl(null);
          setStatus(`Error: ${error.message}`);
        }
      }
    }

    loadEncryptedPreview();

    return () => {
      active = false;
      if (revokeUrl) {
        URL.revokeObjectURL(revokeUrl);
      }
    };
  }, [selectedMessage, mode]);

  const onSelectImage = (event) => {
    const file = event.target.files[0];
    setImageFile(file);
    if (file) {
      setPreviewUrl(URL.createObjectURL(file));
      setStatus(`Selected image: ${file.name}`);
    }
  };

  const downloadBlob = (blob, fileName) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const setEncryptedPreviewSafe = (url) => {
    if (encryptedPreviewUrl) {
      try { URL.revokeObjectURL(encryptedPreviewUrl); } catch (e) {}
    }
    setEncryptedPreviewUrl(url);
  };

  const setDecryptedPreviewSafe = (url) => {
    if (decryptedPreviewUrl) {
      try { URL.revokeObjectURL(decryptedPreviewUrl); } catch (e) {}
    }
    setDecryptedPreviewUrl(url);
  };

  const closePreview = () => {
    if (encryptedPreviewUrl) {
      try { URL.revokeObjectURL(encryptedPreviewUrl); } catch (e) {}
    }
    if (decryptedPreviewUrl) {
      try { URL.revokeObjectURL(decryptedPreviewUrl); } catch (e) {}
    }
    setEncryptedPreviewUrl(null);
    setDecryptedPreviewUrl(null);
    setPreviewOpen(false);
  };

  const fetchInbox = async (receiverName) => {
    if (!receiverName) {
      setStatus('Select a receiver to load inbox.');
      return;
    }

    setStatus('Loading inbox...');
    try {
      const response = await fetch(getApiUrl(`/api/messages/inbox?receiver=${encodeURIComponent(receiverName)}`));
      if (!response.ok) {
        throw new Error('Unable to load inbox.');
      }
      const data = await response.json();
      setInbox(data.messages || []);
      const unreadCount = (data.messages || []).filter((msg) => !msg.isRead).length;
      setStatus(`Inbox updated. ${unreadCount} new message(s).`);
      if (selectedMessage) {
        const updated = (data.messages || []).find((msg) => msg._id === selectedMessage._id);
        setSelectedMessage(updated || null);
      }
    } catch (error) {
      setStatus(`Error: ${error.message}`);
    }
  };

  // Socket.IO: connect and listen for new messages for signedInUser
  useEffect(() => {
    const socket = io(window.location.origin, {
      path: '/socket.io',
      autoConnect: true,
      transports: ['polling'],
      upgrade: false,
      timeout: 5000,
      reconnectionAttempts: 5,
    });

    socket.on('connect', () => {
      if (signedInUser) {
        socket.emit('identify', signedInUser);
      }
      setStatus('Connected to notification server.');
    });

    socket.on('connect_error', (error) => {
      console.warn('Socket connect error:', error.message);
    });

    socket.on('disconnect', (reason) => {
      if (reason === 'io client disconnect') {
        return;
      }
      setStatus(`Socket disconnected: ${reason}`);
    });

    socket.on('new_message', (msg) => {
      if (mode === 'receive' && signedInUser) {
        fetchInbox(signedInUser);
        setStatus(`New message from ${msg.sender}`);
      }
    });

    return () => {
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedInUser, mode]);

  const handleSend = async () => {
    if (!imageFile) {
      setStatus('Choose an image to send.');
      return;
    }
    if (!sender || !receiver) {
      setStatus('Choose both sender and receiver.');
      return;
    }
    if (sender === receiver) {
      setStatus('Sender and receiver should be different users.');
      return;
    }
    if (!sendPassword || sendPassword.length < 4) {
      setStatus('Enter a secure password of at least 4 characters.');
      return;
    }

    const formData = new FormData();
    formData.append('image', imageFile);
    const actualSender = mode === 'send' ? signedInUser || sender : sender;
    formData.append('sender', actualSender);
    formData.append('receiver', receiver);
    formData.append('password', sendPassword);

    setStatus('Sending encrypted message...');
    try {
      const response = await fetch(getApiUrl('/api/messages/send'), {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        throw new Error(errorBody?.message || 'Failed to send message.');
      }
      const data = await response.json();
      setStatus('Encrypted message sent successfully.');
      setImageFile(null);
      setPreviewUrl(null);
      setSendPassword('');

      // Show sender-side encrypted placeholder in the preview sidebar after send
      setEncryptedPreviewSafe(SENDER_ENCRYPTED_PLACEHOLDER);
      setPreviewOpen(true);
    } catch (error) {
      setStatus(`Error: ${error.message}`);
    }
  };

  const handleDecrypt = async () => {
    if (!selectedMessage) {
      setStatus('Select a message from the inbox to decrypt.');
      return;
    }
    if (!decryptPassword || decryptPassword.length < 4) {
      setStatus('Enter the password used to encrypt this message.');
      return;
    }

    setStatus('Decrypting message...');
    try {
      const response = await fetch(getApiUrl(`/api/messages/${selectedMessage._id}/decrypt`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: decryptPassword }),
      });
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        throw new Error(errorBody?.message || 'Decryption failed.');
      }
      const blob = await response.blob();
      const downloadName = `${selectedMessage.originalName.split('.').slice(0, -1).join('.') || selectedMessage.originalName}_decrypted${selectedMessage.originalName.includes('.') ? '.' + selectedMessage.originalName.split('.').pop() : '.png'}`;
      downloadBlob(blob, downloadName);
      const decryptedUrl = URL.createObjectURL(blob);
      setDecryptedPreviewSafe(decryptedUrl);
      setPreviewOpen(true);
      setStatus('Message decrypted and downloaded successfully.');
      setDecryptPassword('');
      fetchInbox(signedInUser);
    } catch (error) {
      setStatus(`Error: ${error.message}`);
    }
  };

  const unreadCount = inbox.filter((message) => !message.isRead).length;

  return (
    <div className="app-shell">
      <header>
        <h1>Secure Image Messenger</h1>
        <p>
          Send encrypted image messages between users. Receivers can see when a new encrypted message arrives and decrypt with the shared key.
        </p>
      </header>

      <div className="signin-bar card">
        <label>
          Sign in as
          <select
            value={signedInUser}
            onChange={(e) => {
              setSignedInUser(e.target.value);
              setSelectedMessage(null);
              setEncryptedPreviewUrl(null);
              setDecryptedPreviewUrl(null);
            }}
          >
            {users.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>

        <label>
          Mode
          <select
            value={mode}
            onChange={(e) => {
              setMode(e.target.value);
              setSelectedMessage(null);
              setEncryptedPreviewUrl(null);
              setDecryptedPreviewUrl(null);
            }}
          >
            <option value="send">Send (Sender)</option>
            <option value="receive">Receive (Receiver)</option>
          </select>
        </label>
      </div>

      <main>
        {mode === 'send' ? (
          <section className="card">
            <h2>Send Encrypted Message</h2>

            <label>
              Sender
              <select
                value={signedInUser || sender}
                onChange={(event) => setSender(event.target.value)}
                disabled={!!signedInUser}
              >
                {users.map((user) => (
                  <option key={user} value={user}>
                    {user}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Receiver
              <select value={receiver} onChange={(event) => setReceiver(event.target.value)}>
                {users.map((user) => (
                  <option key={user} value={user}>
                    {user}
                  </option>
                ))}
              </select>
            </label>

            <label className="file-input">
              Select image to encrypt and send
              <input type="file" accept="image/*" onChange={onSelectImage} />
            </label>

            {previewUrl && (
              <div className="preview">
                <img src={previewUrl} alt="Selected preview" />
              </div>
            )}

            <label>
              Secret key / password
              <input
                type="password"
                value={sendPassword}
                onChange={(event) => setSendPassword(event.target.value)}
                placeholder="At least 4 characters"
              />
            </label>

            <button onClick={handleSend}>Send Secure Message</button>
          </section>
        ) : (
          <section className="card inbox-card">
            <div className="inbox-header">
              <div>
                <h2>Inbox</h2>
                <p className="unread-summary">{unreadCount} new message(s)</p>
              </div>
              <div className="inbox-controls">
                <label>
                  View as user
                  <select value={signedInUser} onChange={(event) => setSignedInUser(event.target.value)}>
                    {users.map((user) => (
                      <option key={user} value={user}>
                        {user}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="secondary" onClick={() => fetchInbox(signedInUser)}>
                  Refresh inbox
                </button>
              </div>
            </div>

            <div className="message-list-container">
              {inbox.length === 0 ? (
                <div className="empty-state">No messages yet for {signedInUser}.</div>
              ) : (
                <ul className="message-list">
                  {inbox.map((message) => (
                    <li
                      key={message._id}
                      className={`message-row ${selectedMessage?._id === message._id ? 'selected' : ''} ${message.isRead ? '' : 'unread'}`}
                      onClick={() => setSelectedMessage(message)}
                    >
                      <div>
                        <div className="message-title">From {message.sender}</div>
                        <div className="message-meta">
                          {message.originalName} • {new Date(message.createdAt).toLocaleString()}
                        </div>
                      </div>
                      {!message.isRead && <span className="badge-new">New</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {selectedMessage && (
              <div className="decrypt-panel">
                <h3>Decrypt selected message</h3>
                <p>
                  Selected message from <strong>{selectedMessage.sender}</strong>:
                  <span className="message-file"> {selectedMessage.originalName}</span>
                </p>
                <label>
                  Password / secret key
                  <input
                    type="password"
                    value={decryptPassword}
                    onChange={(event) => setDecryptPassword(event.target.value)}
                    placeholder="Enter the shared password"
                  />
                </label>
                <button onClick={handleDecrypt}>Decrypt and download</button>

                {/* Previews moved to sidebar */}
              </div>
            )}
          </section>
        )}
        {/* Preview sidebar */}
        <aside className={`preview-sidebar ${previewOpen ? 'open' : 'collapsed'}`}>
          <div className="preview-sidebar-header">
            <h3>Preview</h3>
            <div className="preview-controls">
              {previewOpen && <button className="small" onClick={closePreview}>Close</button>}
            </div>
          </div>
          <div className="preview-sidebar-content">
            {mode === 'send' ? (
              encryptedPreviewUrl ? (
                <div className="preview-block">
                  <h4>Encrypted</h4>
                  <img src={encryptedPreviewUrl} alt="Encrypted preview" />
                </div>
              ) : (
                <div className="empty-state">Encrypted preview will appear here after sending.</div>
              )
            ) : null}

            {mode === 'receive' ? (
              decryptedPreviewUrl ? (
                <div className="preview-block">
                  <h4>Decrypted</h4>
                  <img src={decryptedPreviewUrl} alt="Decrypted preview" />
                </div>
              ) : (
                <div className="empty-state">Decrypt a message to view the decrypted image here.</div>
              )
            ) : (
              decryptedPreviewUrl ? (
                <div className="preview-block">
                  <h4>Decrypted</h4>
                  <img src={decryptedPreviewUrl} alt="Decrypted preview" />
                </div>
              ) : null
            )}
          </div>
        </aside>
      </main>

      <footer>
        <p>{status}</p>
      </footer>
    </div>
  );
}

export default App;
