(function() {
var bdo = require('bdo-js');
var sessionless = require('sessionless-node');
var fs = require('fs');
var path = require('path');

const HASH = 'wiki-zachup-backup';
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const KEYS_FILE = path.join(__dirname, '..', 'zachup-keys.json');
const CONFIG_FILE = path.join(__dirname, '..', 'zachup-config.json');

let bdoUser = null;
let lastBackupTime = null;
let backupTimer = null;
let allyabaseKeys = null;
let config = null;
let isConfigured = false;

// Load keys from file
function loadKeys() {
  try {
    if (fs.existsSync(KEYS_FILE)) {
      const data = fs.readFileSync(KEYS_FILE, 'utf8');
      const keys = JSON.parse(data);
      console.log('Zachup: Loaded existing keys from', KEYS_FILE);
      return keys;
    }
  } catch(err) {
    console.error('Zachup: Error loading keys:', err);
  }
  return null;
}

// Save keys to file
function saveKeysToFile(keys) {
  try {
    fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2), 'utf8');
    console.log('Zachup: Keys saved to', KEYS_FILE);
  } catch(err) {
    console.error('Zachup: Error saving keys:', err);
  }
}

// Load config from file
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      const cfg = JSON.parse(data);
      console.log('Zachup: Loaded configuration from', CONFIG_FILE);
      return cfg;
    }
  } catch(err) {
    console.error('Zachup: Error loading config:', err);
  }
  return null;
}

// Save config to file
function saveConfig(cfg) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
    console.log('Zachup: Configuration saved to', CONFIG_FILE);
    return true;
  } catch(err) {
    console.error('Zachup: Error saving config:', err);
    return false;
  }
}

async function startServer(params) {
  const app = params.app;
  const argv = params.argv;

  console.log('Starting Zachup backup plugin...');

  // Load or generate keys
  allyabaseKeys = loadKeys();

  if (!allyabaseKeys) {
    console.log('Zachup: No existing keys found, generating new keys...');

    const saveKeys = (keys) => {
      allyabaseKeys = keys;
      saveKeysToFile(keys);
    };

    const getKeys = () => allyabaseKeys;

    await sessionless.generateKeys(saveKeys, getKeys);
    console.log('Zachup: New keys generated and saved');
  }

  // Load config
  config = loadConfig();
  if (config && config.bdoUrl) {
    console.log('Zachup: BDO URL configured:', config.bdoUrl);
    await initializeBDO();
  } else {
    console.log('Zachup: No BDO URL configured yet. Waiting for configuration...');
  }

  // Initialize BDO with configured URL
  async function initializeBDO() {
    if (!config || !config.bdoUrl) {
      console.error('Zachup: Cannot initialize BDO - no URL configured');
      return false;
    }

    try {
      bdo.baseURL = config.bdoUrl;

      const saveKeys = () => {};
      const getKeys = () => allyabaseKeys;

      const uuid = await bdo.createUser(HASH, {}, saveKeys, getKeys);
      bdoUser = { uuid };
      isConfigured = true;
      console.log('Zachup: BDO user initialized with UUID:', uuid);

      // Start backups
      console.log('Zachup: Performing initial backup on startup...');
      setTimeout(() => performBackup(), 5000);

      // Schedule regular backups
      if (backupTimer) {
        clearInterval(backupTimer);
      }
      backupTimer = setInterval(performBackup, BACKUP_INTERVAL_MS);
      console.log(`Zachup: Scheduled backups every ${BACKUP_INTERVAL_MS / 1000 / 60 / 60} hours`);

      return true;
    } catch(err) {
      console.error('Zachup: Error initializing BDO user:', err);
      isConfigured = false;
      bdoUser = null;
      return false;
    }
  }

  // Function to perform backup
  async function performBackup() {
    if (!isConfigured || !bdoUser) {
      console.error('Zachup: Cannot perform backup - BDO not configured or user not initialized');
      return;
    }

    console.log('Zachup: Starting backup...');

    try {
      // Get the pagehandler from the app
      const pagehandler = app.pagehandler;

      // Get all pages
      pagehandler.pages(async (err, pages) => {
        if (err) {
          console.error('Zachup: Error getting pages:', err);
          return;
        }

        console.log(`Zachup: Found ${pages.length} pages to backup`);

        // Create a map of slug to page data
        const backupData = {};
        let processedCount = 0;

        // For each page, get the full page data
        for (const pageInfo of pages) {
          if (!pageInfo || !pageInfo.slug) continue;

          pagehandler.get(pageInfo.slug, async (err, page, status) => {
            if (err || status === 404) {
              console.warn(`Zachup: Could not get page ${pageInfo.slug}:`, err);
            } else {
              backupData[pageInfo.slug] = page;
            }

            processedCount++;

            // When all pages are processed, save to BDO
            if (processedCount === pages.length) {
              try {
                const backupObject = {
                  timestamp: new Date().toISOString(),
                  pageCount: Object.keys(backupData).length,
                  pages: backupData
                };

                // Save backup to BDO with public=true so it can be retrieved
                await bdo.updateBDO(bdoUser.uuid, HASH, backupObject, true);
                lastBackupTime = new Date().toISOString();

                console.log(`Zachup: Backup completed successfully! Backed up ${backupObject.pageCount} pages at ${lastBackupTime}`);
              } catch(bdoErr) {
                console.error('Zachup: Error saving backup to BDO:', bdoErr);
              }
            }
          });
        }

        if (pages.length === 0) {
          console.log('Zachup: No pages to backup');
          lastBackupTime = new Date().toISOString();
        }
      });
    } catch(err) {
      console.error('Zachup: Error during backup:', err);
    }
  }

  // Endpoint to get configuration
  app.get('/plugin/zachup/config', function(req, res) {
    res.send({
      configured: isConfigured,
      bdoUrl: config ? config.bdoUrl : null
    });
  });

  // Endpoint to set configuration
  app.post('/plugin/zachup/config', async function(req, res) {
    let { bdoUrl } = req.body;

    if (!bdoUrl) {
      return res.status(400).send({
        success: false,
        error: 'bdoUrl is required'
      });
    }

    // Ensure URL has trailing slash
    bdoUrl = bdoUrl.trim();
    if (!bdoUrl.endsWith('/')) {
      bdoUrl = bdoUrl + '/';
    }

    // Save config
    config = { bdoUrl };
    const saved = saveConfig(config);

    if (!saved) {
      return res.status(500).send({
        success: false,
        error: 'Failed to save configuration'
      });
    }

    // Initialize BDO with new URL
    const initialized = await initializeBDO();

    res.send({
      success: initialized,
      configured: isConfigured,
      bdoUrl: config.bdoUrl,
      bdoUser: bdoUser ? bdoUser.uuid : null
    });
  });

  // Endpoint to get public key
  app.get('/plugin/zachup/pubkey', function(req, res) {
    res.send({
      pubKey: allyabaseKeys ? allyabaseKeys.pubKey : null
    });
  });

  // Endpoint to get backup status
  app.get('/plugin/zachup/status', function(req, res) {
    res.send({
      configured: isConfigured,
      bdoUrl: config ? config.bdoUrl : null,
      lastBackup: lastBackupTime,
      bdoUser: bdoUser ? bdoUser.uuid : null,
      pubKey: allyabaseKeys ? allyabaseKeys.pubKey : null,
      nextBackup: lastBackupTime ?
        new Date(new Date(lastBackupTime).getTime() + BACKUP_INTERVAL_MS).toISOString() :
        'pending'
    });
  });

  // Endpoint to trigger manual backup
  app.post('/plugin/zachup/backup-now', async function(req, res) {
    if (!isConfigured) {
      return res.status(400).send({
        success: false,
        error: 'BDO not configured. Please configure BDO URL first.'
      });
    }

    console.log('Zachup: Manual backup triggered');
    try {
      await performBackup();
      res.send({
        success: true,
        message: 'Backup initiated',
        timestamp: lastBackupTime
      });
    } catch(err) {
      res.status(500).send({
        success: false,
        error: err.message
      });
    }
  });

  // Endpoint to generate curl command for retrieving backup
  app.get('/plugin/zachup/get-curl', async function(req, res) {
    if (!isConfigured || !bdoUser) {
      return res.status(400).send({
        success: false,
        error: 'BDO not configured. Please configure BDO URL first.'
      });
    }

    try {
      const timestamp = new Date().getTime() + '';
      const uuid = bdoUser.uuid;
      const hash = HASH;

      // Generate signature
      const message = timestamp + uuid + hash;
      const signature = await sessionless.sign(message);

      // Construct the curl command
      const bdoUrl = config.bdoUrl.replace(/\/$/, ''); // Remove trailing slash
      const curlCommand = `curl "${bdoUrl}/user/${uuid}/bdo?timestamp=${timestamp}&hash=${hash}&signature=${signature}"`;

      res.send({
        success: true,
        curlCommand,
        bdoUrl,
        uuid,
        hash
      });
    } catch(err) {
      console.error('Zachup: Error generating curl command:', err);
      res.status(500).send({
        success: false,
        error: err.message
      });
    }
  });
}

module.exports = {startServer};
}).call(this);
