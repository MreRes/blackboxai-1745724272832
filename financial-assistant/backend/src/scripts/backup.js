require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const BACKUP_DIR = process.env.BACKUP_PATH || './backups';
const RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS) || 30;

const createBackup = async () => {
    try {
        // Create backup directory if it doesn't exist
        await fs.mkdir(BACKUP_DIR, { recursive: true });

        // Generate timestamp for backup files
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(BACKUP_DIR, `backup-${timestamp}`);

        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('Connected to MongoDB');

        // Get all collections
        const collections = await mongoose.connection.db.collections();

        // Create backup directory for this timestamp
        await fs.mkdir(backupPath);

        // Export each collection
        for (const collection of collections) {
            const collectionName = collection.collectionName;
            const documents = await collection.find({}).toArray();
            
            await fs.writeFile(
                path.join(backupPath, `${collectionName}.json`),
                JSON.stringify(documents, null, 2)
            );

            console.log(`Backed up collection: ${collectionName}`);
        }

        // Create zip archive
        const zipPath = `${backupPath}.zip`;
        await execAsync(`zip -r "${zipPath}" "${backupPath}"`);

        // Remove unzipped directory
        await fs.rm(backupPath, { recursive: true });

        console.log(`Backup created successfully: ${zipPath}`);

        // Cleanup old backups
        await cleanupOldBackups();

        // Create backup metadata
        const stats = await fs.stat(zipPath);
        const metadata = {
            timestamp,
            size: stats.size,
            collections: collections.map(c => c.collectionName)
        };

        await fs.writeFile(
            path.join(BACKUP_DIR, 'backup-metadata.json'),
            JSON.stringify(metadata, null, 2)
        );

        return {
            success: true,
            path: zipPath,
            metadata
        };

    } catch (error) {
        console.error('Backup failed:', error);
        return {
            success: false,
            error: error.message
        };
    } finally {
        await mongoose.connection.close();
        console.log('Database connection closed');
    }
};

const cleanupOldBackups = async () => {
    try {
        // Get all backup files
        const files = await fs.readdir(BACKUP_DIR);
        const backupFiles = files.filter(f => f.startsWith('backup-') && f.endsWith('.zip'));

        // Calculate cutoff date
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

        // Check each backup file
        for (const file of backupFiles) {
            const filePath = path.join(BACKUP_DIR, file);
            const stats = await fs.stat(filePath);

            // Delete if older than retention period
            if (stats.mtime < cutoffDate) {
                await fs.unlink(filePath);
                console.log(`Deleted old backup: ${file}`);
            }
        }

        console.log('Cleanup completed');
    } catch (error) {
        console.error('Cleanup failed:', error);
    }
};

const restoreBackup = async (backupPath) => {
    try {
        // Extract backup
        const extractPath = path.join(BACKUP_DIR, 'temp-restore');
        await fs.mkdir(extractPath, { recursive: true });
        await execAsync(`unzip "${backupPath}" -d "${extractPath}"`);

        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('Connected to MongoDB');

        // Get all collection files
        const files = await fs.readdir(extractPath);
        const collectionFiles = files.filter(f => f.endsWith('.json'));

        // Restore each collection
        for (const file of collectionFiles) {
            const collectionName = path.basename(file, '.json');
            const data = JSON.parse(
                await fs.readFile(path.join(extractPath, file), 'utf8')
            );

            // Drop existing collection
            await mongoose.connection.db.collection(collectionName).drop().catch(() => {});

            // Insert data if not empty
            if (data.length > 0) {
                await mongoose.connection.db.collection(collectionName).insertMany(data);
            }

            console.log(`Restored collection: ${collectionName}`);
        }

        // Cleanup
        await fs.rm(extractPath, { recursive: true });

        return {
            success: true,
            message: 'Backup restored successfully'
        };

    } catch (error) {
        console.error('Restore failed:', error);
        return {
            success: false,
            error: error.message
        };
    } finally {
        await mongoose.connection.close();
        console.log('Database connection closed');
    }
};

// Command line interface
const main = async () => {
    const args = process.argv.slice(2);
    const command = args[0];
    const backupPath = args[1];

    switch (command) {
        case 'create':
            console.log('Creating backup...');
            const result = await createBackup();
            console.log(result);
            break;

        case 'restore':
            if (!backupPath) {
                console.error('Please provide backup path');
                process.exit(1);
            }
            console.log('Restoring backup...');
            const restoreResult = await restoreBackup(backupPath);
            console.log(restoreResult);
            break;

        case 'cleanup':
            console.log('Cleaning up old backups...');
            await cleanupOldBackups();
            break;

        default:
            console.log(`
Usage:
  node backup.js create                    Create new backup
  node backup.js restore <backup-path>     Restore from backup
  node backup.js cleanup                   Clean up old backups
            `);
            break;
    }

    process.exit(0);
};

// Run if called directly
if (require.main === module) {
    main().catch(error => {
        console.error('Error:', error);
        process.exit(1);
    });
}

// Export functions for use in other scripts
module.exports = {
    createBackup,
    restoreBackup,
    cleanupOldBackups
};
