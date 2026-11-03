const path = require('node:path');

const CRM_DATA_DIRECTORY = 'RelationDesk CRM';
const CRM_DATABASE_FILE = 'crm-repository.sqlite';

function desktopPaths(appDataDirectory) {
  if (typeof appDataDirectory !== 'string' || !path.isAbsolute(appDataDirectory)) {
    throw new Error('Electron appData path must be absolute.');
  }
  const userData = path.join(appDataDirectory, CRM_DATA_DIRECTORY);
  return Object.freeze({
    userData,
    database: path.join(userData, CRM_DATABASE_FILE),
  });
}

module.exports = { desktopPaths };
