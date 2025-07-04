const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Endpoint for server status check
app.get('/', (req, res) => {
    res.json({ 
        message: 'OGMP3 Server is running!', 
        status: 'active',
        endpoints: {
            convert: 'POST /convert',
            download: 'GET /download/:filename',
            info: 'POST /info'
        }
    });
});

// Endpoint for conversion
app.post('/convert', async (req, res) => {
    const { url } = req.body;
    
    if (!url) {
        return res.status(400).json({ error: 'URL is missing' });
    }

    try {
        // Check if URL is valid YouTube
        if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
            return res.status(400).json({ error: 'Invalid URL - YouTube only' });
        }

        // Create downloads directory if it doesn't exist
        const downloadsDir = path.join(__dirname, 'downloads');
        if (!fs.existsSync(downloadsDir)) {
            fs.mkdirSync(downloadsDir);
        }

        // Generate unique filename
        const fileName = `video_${Date.now()}`;
        const outputPath = path.join(downloadsDir, `${fileName}.%(ext)s`);
        
        // yt-dlp command for MP3 conversion
        const command = `yt-dlp -x --audio-format mp3 --audio-quality 0 -o "${outputPath}" "${url}"`;
        
        console.log('Starting conversion for:', url);
        console.log('Command:', command);
        
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error('Conversion error:', error);
                console.error('Stderr:', stderr);
                return res.status(500).json({ error: 'Conversion error: ' + error.message });
            }
            
            console.log('Stdout:', stdout);
            
            // Look for generated MP3 file
            try {
                const files = fs.readdirSync(downloadsDir);
                const mp3File = files.find(file => file.startsWith(fileName) && file.endsWith('.mp3'));
                
                if (mp3File) {
                    const downloadUrl = `/download/${mp3File}`;
                    console.log('Conversion successful:', mp3File);
                    res.json({ 
                        success: true, 
                        downloadUrl: downloadUrl,
                        filename: mp3File
                    });
                } else {
                    console.error('MP3 file not found in:', files);
                    res.status(500).json({ error: 'MP3 file not found' });
                }
            } catch (readError) {
                console.error('Directory reading error:', readError);
                res.status(500).json({ error: 'File reading error' });
            }
        });
        
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Server error: ' + error.message });
    }
});

// Endpoint for download
app.get('/download/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, 'downloads', filename);
    
    console.log('Download request for:', filename);
    console.log('Full path:', filePath);
    
    if (fs.existsSync(filePath)) {
        res.download(filePath, (err) => {
            if (err) {
                console.error('Download error:', err);
            } else {
                console.log('Download successful:', filename);
                // Delete file after download
                setTimeout(() => {
                    try {
                        if (fs.existsSync(filePath)) {
                            fs.unlinkSync(filePath);
                            console.log('File deleted:', filename);
                        }
                    } catch (deleteError) {
                        console.error('File deletion error:', deleteError);
                    }
                }, 5000);
            }
        });
    } else {
        console.error('File does not exist:', filePath);
        res.status(404).json({ error: 'File does not exist' });
    }
});

// Endpoint for video information
app.post('/info', (req, res) => {
    const { url } = req.body;
    
    if (!url) {
        return res.status(400).json({ error: 'URL is missing' });
    }

    const command = `yt-dlp -j "${url}"`;
    
    console.log('Retrieving information for:', url);
    
    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error('Info retrieval error:', error);
            return res.status(500).json({ error: 'Could not retrieve information' });
        }
        
        try {
            const info = JSON.parse(stdout);
            res.json({
                title: info.title,
                duration: info.duration,
                uploader: info.uploader,
                thumbnail: info.thumbnail
            });
        } catch (parseError) {
            console.error('JSON parsing error:', parseError);
            res.status(500).json({ error: 'Information processing error' });
        }
    });
});

// Endpoint for listing files
app.get('/files', (req, res) => {
    const downloadsDir = path.join(__dirname, 'downloads');
    
    if (!fs.existsSync(downloadsDir)) {
        return res.json({ files: [] });
    }
    
    try {
        const files = fs.readdirSync(downloadsDir).map(file => ({
            name: file,
            size: fs.statSync(path.join(downloadsDir, file)).size,
            created: fs.statSync(path.join(downloadsDir, file)).birthtime
        }));
        
        res.json({ files });
    } catch (error) {
        console.error('File listing error:', error);
        res.json({ files: [] });
    }
});

// Cleanup - delete old files
setInterval(() => {
    const downloadsDir = path.join(__dirname, 'downloads');
    
    if (!fs.existsSync(downloadsDir)) {
        return;
    }
    
    try {
        const files = fs.readdirSync(downloadsDir);
        const now = Date.now();
        
        files.forEach(file => {
            const filePath = path.join(downloadsDir, file);
            const stats = fs.statSync(filePath);
            const fileAge = now - stats.mtime.getTime();
            
            // Delete files older than 10 minutes
            if (fileAge > 10 * 60 * 1000) {
                fs.unlinkSync(filePath);
                console.log('Deleted old file:', file);
            }
        });
    } catch (error) {
        console.error('Cleanup error:', error);
    }
}, 5 * 60 * 1000); // Run every 5 minutes

// Cleanup on server shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Stopping server...');
    const downloadsDir = path.join(__dirname, 'downloads');
    
    if (fs.existsSync(downloadsDir)) {
        try {
            const files = fs.readdirSync(downloadsDir);
            files.forEach(file => {
                fs.unlinkSync(path.join(downloadsDir, file));
            });
            console.log('🗑️  Temporary files deleted');
        } catch (error) {
            console.error('Final cleanup error:', error);
        }
    }
    process.exit(0);
});

app.listen(PORT, () => {
    console.log(`🚀 OGMP3 Server running on http://localhost:${PORT}`);
    console.log('📁 Ready for YouTube to MP3 conversions!');
    console.log('🌐 Available endpoints:');
    console.log('   GET  / - Server status');
    console.log('   POST /convert - Video conversion');
    console.log('   GET  /download/:filename - File download');
    console.log('   POST /info - Video information');
    console.log('   GET  /files - File list');
});