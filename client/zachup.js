let backupStatus = null;

async function post(url, payload) {
  return await fetch(url, {
    method: 'post',
    body: JSON.stringify(payload),
    headers: {'Content-Type': 'application/json'}
  });
}

async function getConfig() {
  try {
    const response = await fetch('/plugin/zachup/config');
    const config = await response.json();
    return config;
  } catch(err) {
    console.error('Error fetching config:', err);
    return null;
  }
}

async function setConfig(bdoUrl) {
  try {
    // Ensure URL has trailing slash
    const normalizedUrl = bdoUrl.trim().endsWith('/') ? bdoUrl.trim() : bdoUrl.trim() + '/';

    const response = await post('/plugin/zachup/config', { bdoUrl: normalizedUrl });
    const result = await response.json();
    return result;
  } catch(err) {
    console.error('Error setting config:', err);
    return { success: false, error: err.message };
  }
}

async function getBackupStatus() {
  try {
    const response = await fetch('/plugin/zachup/status');
    const status = await response.json();
    return status;
  } catch(err) {
    console.error('Error fetching backup status:', err);
    return null;
  }
}

async function triggerBackup() {
  try {
    const response = await post('/plugin/zachup/backup-now', {});
    const result = await response.json();
    return result;
  } catch(err) {
    console.error('Error triggering backup:', err);
    return { success: false, error: err.message };
  }
}

function formatDate(isoString) {
  if (!isoString || isoString === 'pending') {
    return 'pending';
  }
  const date = new Date(isoString);
  return date.toLocaleString();
}

function renderConfigUI(containerDiv, currentUrl) {
  containerDiv.innerHTML = `
    <div style="padding: 10px; background: #fff3cd; border: 1px solid #ffc107; border-radius: 5px;">
      <h3>⚙️ Zachup Configuration Required</h3>
      <p>Please configure the BDO server URL to enable wiki backups.</p>
      <div style="margin: 15px 0;">
        <label style="display: block; margin-bottom: 5px; font-weight: bold;">BDO Server URL:</label>
        <input
          type="text"
          id="bdo-url-input"
          value="${currentUrl || 'http://localhost:3003/'}"
          placeholder="http://localhost:3003/"
          style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; font-family: monospace;"
        />
        <small style="display: block; margin-top: 5px; color: #666;">
          Example: http://localhost:3003/ or https://bdo.yourserver.com/
        </small>
      </div>
      <button
        id="save-config-btn"
        style="padding: 8px 16px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;"
      >
        Save Configuration
      </button>
      <div id="config-message" style="margin-top: 10px; padding: 8px; display: none;"></div>
    </div>
  `;

  // Add event handler
  setTimeout(() => {
    const saveBtn = document.getElementById('save-config-btn');
    const urlInput = document.getElementById('bdo-url-input');
    const messageDiv = document.getElementById('config-message');

    if (saveBtn && urlInput) {
      saveBtn.addEventListener('click', async () => {
        let bdoUrl = urlInput.value.trim();

        if (!bdoUrl) {
          messageDiv.style.background = '#f8d7da';
          messageDiv.style.color = '#721c24';
          messageDiv.textContent = 'Please enter a BDO URL';
          messageDiv.style.display = 'block';
          return;
        }

        // Basic URL validation
        if (!bdoUrl.startsWith('http://') && !bdoUrl.startsWith('https://')) {
          messageDiv.style.background = '#f8d7da';
          messageDiv.style.color = '#721c24';
          messageDiv.textContent = 'URL must start with http:// or https://';
          messageDiv.style.display = 'block';
          return;
        }

        // Normalize URL with trailing slash
        const normalizedUrl = bdoUrl.endsWith('/') ? bdoUrl : bdoUrl + '/';

        // Update input to show normalized URL
        if (normalizedUrl !== bdoUrl) {
          urlInput.value = normalizedUrl;
        }

        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
        messageDiv.style.display = 'none';

        const result = await setConfig(normalizedUrl);

        if (result.success && result.configured) {
          messageDiv.style.background = '#d4edda';
          messageDiv.style.color = '#155724';
          messageDiv.textContent = `Configuration saved! BDO initialized with UUID: ${result.bdoUser}`;
          messageDiv.style.display = 'block';

          // Switch to backup UI after 2 seconds
          setTimeout(() => {
            getBackupStatus().then(status => {
              if (status && status.configured) {
                renderBackupUI(containerDiv, status);
              }
            });
          }, 2000);
        } else {
          messageDiv.style.background = '#f8d7da';
          messageDiv.style.color = '#721c24';
          messageDiv.textContent = `Configuration failed: ${result.error || 'Unknown error'}`;
          messageDiv.style.display = 'block';
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save Configuration';
        }
      });
    }
  }, 100);
}

function renderBackupUI(containerDiv, status) {
  const pubKeyShort = status.pubKey ?
    status.pubKey.substring(0, 16) + '...' + status.pubKey.substring(status.pubKey.length - 8) :
    'Not available';

  containerDiv.innerHTML = `
    <div style="padding: 10px; background: #f5f5f5; border-radius: 5px;">
      <h3>Wiki Backup Status</h3>
      <p><strong>BDO Server:</strong> <span style="font-family: monospace; font-size: 0.9em;">${status.bdoUrl || 'Not configured'}</span></p>
      <p><strong>BDO User UUID:</strong> ${status.bdoUser || 'Not initialized'}</p>
      <p>
        <strong>Public Key:</strong>
        <span style="font-family: monospace; font-size: 0.9em;">${pubKeyShort}</span>
        ${status.pubKey ? '<button id="copy-pubkey-btn" style="margin-left: 8px; padding: 4px 8px; font-size: 0.8em; cursor: pointer;">Copy Full Key</button>' : ''}
      </p>
      <p><strong>Last Backup:</strong> ${formatDate(status.lastBackup)}</p>
      <p><strong>Next Scheduled Backup:</strong> ${formatDate(status.nextBackup)}</p>
      <div style="margin-top: 15px;">
        <button id="backup-now-btn" style="padding: 8px 16px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; margin-right: 8px;">
          Backup Now
        </button>
        <button id="get-curl-btn" style="padding: 8px 16px; background: #17a2b8; color: white; border: none; border-radius: 4px; cursor: pointer; margin-right: 8px;">
          Get Curl Command
        </button>
        <button id="reconfigure-btn" style="padding: 8px 16px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer;">
          Reconfigure
        </button>
      </div>
      <div id="curl-display" style="margin-top: 15px; padding: 10px; background: #e9ecef; border-radius: 4px; display: none;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <strong>Curl Command to Retrieve Backup:</strong>
          <button id="copy-curl-btn" style="padding: 4px 8px; font-size: 0.8em; cursor: pointer;">Copy Command</button>
        </div>
        <pre id="curl-command" style="background: white; padding: 10px; border-radius: 4px; overflow-x: auto; font-size: 0.85em; margin: 0;"></pre>
        <small style="display: block; margin-top: 8px; color: #666;">
          This command will retrieve your wiki backup from BDO. The signature is valid for a limited time.
        </small>
      </div>
      <div id="backup-message" style="margin-top: 10px; padding: 8px; display: none;"></div>
    </div>
  `;

  // Add click handler for copy button
  setTimeout(() => {
    const copyBtn = document.getElementById('copy-pubkey-btn');
    if (copyBtn && status.pubKey) {
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(status.pubKey).then(() => {
          const originalText = copyBtn.textContent;
          copyBtn.textContent = 'Copied!';
          copyBtn.style.background = '#4CAF50';
          copyBtn.style.color = 'white';
          setTimeout(() => {
            copyBtn.textContent = originalText;
            copyBtn.style.background = '';
            copyBtn.style.color = '';
          }, 2000);
        }).catch(err => {
          console.error('Failed to copy pubKey:', err);
          copyBtn.textContent = 'Failed to copy';
          setTimeout(() => {
            copyBtn.textContent = 'Copy Full Key';
          }, 2000);
        });
      });
    }
  }, 100);

  // Add click handler for reconfigure button
  setTimeout(() => {
    const reconfigureBtn = document.getElementById('reconfigure-btn');
    if (reconfigureBtn) {
      reconfigureBtn.addEventListener('click', () => {
        renderConfigUI(containerDiv, status.bdoUrl);
      });
    }
  }, 100);

  // Add click handler for get curl button
  setTimeout(() => {
    const getCurlBtn = document.getElementById('get-curl-btn');
    const curlDisplay = document.getElementById('curl-display');
    const curlCommandPre = document.getElementById('curl-command');
    const copyCurlBtn = document.getElementById('copy-curl-btn');

    if (getCurlBtn) {
      getCurlBtn.addEventListener('click', async () => {
        getCurlBtn.disabled = true;
        getCurlBtn.textContent = 'Generating...';

        try {
          const response = await fetch('/plugin/zachup/get-curl');
          const result = await response.json();

          if (result.success && result.curlCommand) {
            curlCommandPre.textContent = result.curlCommand;
            curlDisplay.style.display = 'block';

            // Set up copy button handler
            if (copyCurlBtn) {
              copyCurlBtn.onclick = () => {
                navigator.clipboard.writeText(result.curlCommand).then(() => {
                  const originalText = copyCurlBtn.textContent;
                  copyCurlBtn.textContent = 'Copied!';
                  copyCurlBtn.style.background = '#4CAF50';
                  copyCurlBtn.style.color = 'white';
                  setTimeout(() => {
                    copyCurlBtn.textContent = originalText;
                    copyCurlBtn.style.background = '';
                    copyCurlBtn.style.color = '';
                  }, 2000);
                }).catch(err => {
                  console.error('Failed to copy curl command:', err);
                  copyCurlBtn.textContent = 'Failed to copy';
                  setTimeout(() => {
                    copyCurlBtn.textContent = 'Copy Command';
                  }, 2000);
                });
              };
            }
          } else {
            curlCommandPre.textContent = `Error: ${result.error || 'Failed to generate curl command'}`;
            curlDisplay.style.display = 'block';
          }
        } catch(err) {
          console.error('Error getting curl command:', err);
          curlCommandPre.textContent = `Error: ${err.message}`;
          curlDisplay.style.display = 'block';
        }

        getCurlBtn.disabled = false;
        getCurlBtn.textContent = 'Get Curl Command';
      });
    }
  }, 100);

  // Add click handler for backup button
  setTimeout(() => {
    const backupBtn = document.getElementById('backup-now-btn');
    const messageDiv = document.getElementById('backup-message');

    if (backupBtn) {
      backupBtn.addEventListener('click', async () => {
        backupBtn.disabled = true;
        backupBtn.textContent = 'Backing up...';
        messageDiv.style.display = 'none';

        const result = await triggerBackup();

        if (result.success) {
          messageDiv.style.background = '#d4edda';
          messageDiv.style.color = '#155724';
          messageDiv.textContent = `Backup initiated successfully at ${formatDate(result.timestamp)}`;
        } else {
          messageDiv.style.background = '#f8d7da';
          messageDiv.style.color = '#721c24';
          messageDiv.textContent = `Backup failed: ${result.error || 'Unknown error'}`;
        }

        messageDiv.style.display = 'block';
        backupBtn.disabled = false;
        backupBtn.textContent = 'Backup Now';

        // Refresh status after backup
        setTimeout(async () => {
          const newStatus = await getBackupStatus();
          if (newStatus) {
            backupStatus = newStatus;
            const lastBackupP = containerDiv.querySelector('p:nth-of-type(4)');
            const nextBackupP = containerDiv.querySelector('p:nth-of-type(5)');
            if (lastBackupP) {
              lastBackupP.innerHTML = `<strong>Last Backup:</strong> ${formatDate(newStatus.lastBackup)}`;
            }
            if (nextBackupP) {
              nextBackupP.innerHTML = `<strong>Next Scheduled Backup:</strong> ${formatDate(newStatus.nextBackup)}`;
            }
          }
        }, 2000);
      });
    }
  }, 100);
}

function emit($item, item) {
  $item.empty();

  const containerDiv = document.createElement('div');
  containerDiv.innerHTML = '<p>Loading...</p>';
  $item.append(containerDiv);

  getBackupStatus()
    .then(status => {
      backupStatus = status;

      if (status.configured) {
        renderBackupUI(containerDiv, status);
      } else {
        renderConfigUI(containerDiv, status.bdoUrl);
      }
    })
    .catch(err => {
      containerDiv.innerHTML = '<p>Error loading status. Check console for details.</p>';
      console.error('Error in emit:', err);
    });
}

function bind($item, item) {
  // Binding logic if needed for interaction
}

if(window) {
  window.plugins['zachup'] = {emit, bind};
}

export const zachup = typeof window == 'undefined' ? { emit, bind } : undefined;
