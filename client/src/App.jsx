import { useEffect, useState } from 'react';

const users = ['Alice', 'Bob', 'Charlie'];

function App() {
  const [currentUser, setCurrentUser] = useState(users[0]);
  const [sender, setSender] = useState(users[0]);
  const [receiver, setReceiver] = useState(users[1]);
  const [imageFile, setImageFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [sendPassword, setSendPassword] = useState('');
  const [decryptPassword, setDecryptPassword] = useState('');
  const [status, setStatus] = useState('Ready to send or receive secure image messages.');
  const [inbox, setInbox] = useState([]);
  const [selectedMessage, setSelectedMessage] = useState(null);

  useEffect(() => {
    fetchInbox(currentUser);
  }, [currentUser]);

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

  const fetchInbox = async (receiverName) => {
    if (!receiverName) {
      setStatus('Select a receiver to load inbox.');
      return;
    }

    setStatus('Loading inbox...');
    try {
      const response = await fetch(`/api/messages/inbox?receiver=${encodeURIComponent(receiverName)}`);
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
    formData.append('sender', sender);
    formData.append('receiver', receiver);
    formData.append('password', sendPassword);

    setStatus('Sending encrypted message...');
    try {
      const response = await fetch('/api/messages/send', {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        throw new Error(errorBody?.message || 'Failed to send message.');
      }
      await response.json();
      setStatus('Encrypted message sent successfully.');
      setImageFile(null);
      setPreviewUrl(null);
      setSendPassword('');
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
      const response = await fetch(`/api/messages/${selectedMessage._id}/decrypt`, {
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
      setStatus('Message decrypted and downloaded successfully.');
      setDecryptPassword('');
      fetchInbox(currentUser);
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

      <main>
        <section className="card">
          <h2>Send Encrypted Message</h2>

          <label>
            Sender
            <select value={sender} onChange={(event) => setSender(event.target.value)}>
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

        <section className="card inbox-card">
          <div className="inbox-header">
            <div>
              <h2>Inbox</h2>
              <p className="unread-summary">{unreadCount} new message(s)</p>
            </div>
            <div className="inbox-controls">
              <label>
                View as user
                <select value={currentUser} onChange={(event) => setCurrentUser(event.target.value)}>
                  {users.map((user) => (
                    <option key={user} value={user}>
                      {user}
                    </option>
                  ))}
                </select>
              </label>
              <button className="secondary" onClick={() => fetchInbox(currentUser)}>
                Refresh inbox
              </button>
            </div>
          </div>

          <div className="message-list-container">
            {inbox.length === 0 ? (
              <div className="empty-state">No messages yet for {currentUser}.</div>
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
            </div>
          )}
        </section>
      </main>

      <footer>
        <p>{status}</p>
      </footer>
    </div>
  );
}

export default App;
