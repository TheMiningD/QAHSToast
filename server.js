require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql');
const SpotifyWebApi = require('spotify-web-api-node');
const fetch = require('node-fetch');

const app = express();
app.use(bodyParser.json());
app.use(express.static('public'));

const pool = mysql.createPool({
    connectionLimit: 10,
    host: process.env.MYSQL_ADDON_HOST,
    user: process.env.MYSQL_ADDON_USER,
    password: process.env.MYSQL_ADDON_PASSWORD,
    database: process.env.MYSQL_ADDON_DB
});

function executeQuery(sql, params, callback) {
    pool.getConnection(function(err, connection) {
        if (err) {
            connection.release();
            callback(err, null);
            throw err;
        }

        connection.query(sql, params, function(error, results, fields) {
            connection.release();
            if (error) {
                if (error.code === 'PROTOCOL_CONNECTION_LOST') {
                    console.error('Database connection was closed.');
                } else if (error.code === 'ER_CON_COUNT_ERROR') {
                    console.error('Database has too many connections.');
                } else if (error.code === 'ECONNREFUSED') {
                    console.error('Database connection was refused.');
                } else {
                    console.error('Error executing query:', error);
                }
                callback(error, null);
            } else {
                callback(null, results);
            }
        });

        connection.on('error', function(err) {
            connection.release();
            console.error('DB error event:', err);
            callback(err, null);
        });
    });
}


// Connect to MySQL Database
connection.connect((err) => {
    if (err) throw err;
    console.log('Connected to MySQL Database.');
});

// Spotify API setup
const spotifyApi = new SpotifyWebApi({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri: process.env.REDIRECT_URI
});

// Spotify playlist ID for "Toast Tunes"
const playlistId = '7wScP4Wjs5yJ1WLDhdsSI8';

let accessTokenExpiry = 0; //ignore

async function refreshAccessToken() {
    try {
        // Retrieve refresh token from the database
        executeQuery('SELECT value FROM settings WHERE `key` = "refreshToken"', async (err, results) => {
            if (err) throw err;
            const refresh_token = results[0].value;
            spotifyApi.setRefreshToken(refresh_token);

            const data = await spotifyApi.refreshAccessToken();
            spotifyApi.setAccessToken(data.body['access_token']);

            // Update refresh token in the database
            executeQuery('UPDATE settings SET value = ? WHERE `key` = "refreshToken"', [data.body['refresh_token']], (err, results) => {
                if (err) throw err;
                console.log('Access token refreshed and set in the database');
            });
        });
    } catch (err) {
        console.error('Error while trying to refresh access token:', err);
    }
}

app.post('/add-to-playlist', async (req, res) => {
    try {
        await refreshAccessToken();
        console.log('Adding track to playlist...');
        const trackId = req.body.trackId;
        const trackUri = `spotify:track:${trackId}`;

        // Add track to playlist
        await spotifyApi.addTracksToPlaylist(playlistId, [trackUri]);
        console.log('Track added to playlist', trackId);

        // Add track to user's queue
        const accessToken = spotifyApi.getAccessToken(); // Get the access token
        await addToQueue(trackUri, accessToken);

        res.send('Track added to playlist and queued');
    } catch (err) {
        console.error('Error in adding track to playlist or queuing', err);
        res.status(500).send('Error processing your request');
    }
});


// Route to find the position of a song in the queue
app.get('/findPositionInQueue/:trackId', async (req, res) => {
    try {
        await refreshAccessToken(); // Refresh token before making the API call
        const response = await fetch('https://api.spotify.com/v1/me/player/queue', {
            method: 'GET',
            headers: { 'Authorization': 'Bearer ' + spotifyApi.getAccessToken() }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch the queue: ${response.statusText}`);
        }

        const data = await response.json();

        // Check if the queue contains the specified track
        if (data && data.queue) {
            const trackIndex = data.queue.findIndex(item => item.id === req.params.trackId);
            res.json({ position: trackIndex >= 0 ? trackIndex + 1 : -1 });
        } else {
            res.status(404).send('Queue is empty or not structured as expected');
        }
    } catch (error) {
        console.error('Error finding song in queue:', error);
        res.status(500).send('Error finding song in queue');
    }
});


async function addToQueue(trackUri, accessToken) {
    try {
        const response = await fetch(`https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(trackUri)}`, { //not sure why this needs the full thing, breaks without it
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + accessToken }
        });

        if (!response.ok) {
            throw new Error(`Failed to queue track: ${response.statusText}`);
        }

        console.log('Track queued successfully');
    } catch (err) {
        console.error('Error adding track to queue', err);
        throw err; // Re-throw the error to be caught by the caller
    }
}

// Endpoint to handle POST requests for new orders
app.post('/api/order', (req, res) => {
    const { name, notes } = req.body;
    console.log('Notes:', notes);

    // Reconstruct orderDetails from the individual fields
    let orderDetails = {};
    for (const key in req.body) {
        if (key.startsWith('toastType') || key.startsWith('quantity')) {
            orderDetails[key] = req.body[key];
        }
    }

    // Check if orderDetails is empty, set to empty object if so
    const detailsToStore = Object.keys(orderDetails).length === 0 ? '{}' : JSON.stringify(orderDetails);

    const query = 'INSERT INTO orders (name, order_details, notes) VALUES (?, ?, ?)';
    executeQuery(query, [name, detailsToStore, notes], (err, result) => {
    console.log('Notes 2:', notes);
        if (err) {
            console.error('Error in inserting order:', err);
            return res.status(500).send('Error in processing order');
        }
        res.json({ success: true, orderId: result.insertId });
    });
});


// Endpoint to retrieve all orders
app.get('/api/orders', (req, res) => {
    executeQuery('SELECT * FROM orders', (err, results) => {
        if (err) throw err;
        res.json(results);
    });
});

app.get('/api/get-order-ready-time', (req, res) => {
    executeQuery('SELECT value FROM settings WHERE `key` = "orderReadyTime"', (err, results) => {
        if (err) {
            console.error('Error fetching order ready time:', err);
            return res.status(500).send('Error fetching order ready time');
        }
        if (results.length > 0) {
            res.json({ orderReadyTime: results[0].value });
        } else {
            res.status(404).send('Order ready time setting not found');
        }
    });
});


app.get('/api/get-order-taking-state', (req, res) => {
    executeQuery('SELECT value FROM settings WHERE `key` = "orderTakingEnabled"', (err, results) => {
        if (err) {
            return res.status(500).send('Error fetching order taking status');
        }
        if (results.length > 0) {
            res.json({ value: results[0].value });
        } else {
            res.status(404).send('Order taking setting not found');
        }
    });
});

app.get('/api/order/:orderId', (req, res) => {
    const orderId = req.params.orderId;

    executeQuery('SELECT * FROM orders WHERE id = ?', [orderId], (err, results) => {
        if (err) {
            res.status(500).send('Error retrieving order');
        } else {
            if (results.length > 0) {
                res.json(results[0]);
            } else {
                res.status(404).send('Order not found');
            }
        }
    });
});

// Endpoint to toggle order taking status
app.post('/api/toggle-order-taking', (req, res) => {
    // Fetch the current value
    executeQuery('SELECT value FROM settings WHERE `key` = "orderTakingEnabled"', (err, results) => {
        if (err) {
            console.error('Error fetching order taking status:', err);
            return res.status(500).send('Error fetching order taking status');
        }
        if (results.length === 0) {
            return res.status(404).send('Order taking setting not found');
        }

        // Determine the new value
        const currentValue = results[0].value;
        const newValue = currentValue === '1' ? '0' : '1';

        // Update with the new value
        executeQuery('UPDATE settings SET value = ? WHERE `key` = "orderTakingEnabled"', [newValue], (err, result) => {
            if (err) {
                console.error('Error updating order taking status:', err);
                return res.status(500).send('Error updating order taking status');
            }
            res.json({ success: true, message: 'Order taking toggled', newValue: newValue });
        });
    });
});

app.post('/api/update-order-ready-time', (req, res) => {
    const { newTime } = req.body;
    executeQuery('UPDATE settings SET value = ? WHERE `key` = "orderReadyTime"', [newTime], (err, result) => {
        if (err) {
            console.error('Error updating order ready time:', err);
            return res.status(500).send('Error: ' + err.message);
        }
        res.json({ success: true, message: 'Order ready time updated' });
    });
});




// Endpoint to serve an order
app.post('/api/serve-order', (req, res) => {
    const { orderId } = req.body;

    connection.beginTransaction((err) => {
        if (err) { throw err; }

        // Update the order with the served_at timestamp
        executeQuery('UPDATE orders SET served_at = NOW() WHERE id = ?', [orderId], (error, results) => {
            if (error) {
                return connection.rollback(() => {
                    throw error;
                });
            }

            // Move the order to the served_orders table
executeQuery('INSERT INTO served_orders (id, name, order_details, created_at, served_at) SELECT id, name, order_details, created_at, NOW() FROM orders WHERE id = ?', [orderId], (error, results) => {
                if (error) {
                    return connection.rollback(() => {
                        throw error;
                    });
                }

                executeQuery('DELETE FROM orders WHERE id = ?', [orderId], (error, results) => {
                    if (error) {
                        return connection.rollback(() => {
                            throw error;
                        });
                    }
                    connection.commit((err) => {
                        if (err) {
                            return connection.rollback(() => {
                                throw err;
                            });
                        }
                        console.log('Order served and moved to served_orders table');
                        res.json({ success: true, message: 'Order served' });
                    });
                });
            });
        });
    });
});

// Fetch all available toast types
app.get('/api/toast-types', (req, res) => {
    executeQuery('SELECT * FROM toast_types WHERE available = TRUE', (err, results) => {
        if (err) return res.status(500).send('Error fetching toast types');
        res.json(results);
    });
});



app.get('/callback', async (req, res) => {
    const code = req.query.code;
    try {
        const data = await spotifyApi.authorizationCodeGrant(code);
        const { access_token, refresh_token } = data.body;
        spotifyApi.setAccessToken(access_token);

        // Store the refresh token in your database instead of a file
        executeQuery('INSERT INTO settings (`key`, value) VALUES ("refreshToken", ?) ON DUPLICATE KEY UPDATE value = ?', [refresh_token, refresh_token], (err, results) => {
            if (err) throw err;
            res.redirect('/music.html');
        });
    } catch (err) {
        console.error('Error during authorization', err);
        res.status(500).send('Authorization error');
    }
});



app.post('/api/add-toast-type', (req, res) => {
    const { code, type } = req.body;

    // Check if both code and type are provided
    if (!code || !type) {
        return res.status(400).send('Both code and type are required');
    }

    // Insert the new toast type with its code
    executeQuery('INSERT INTO toast_types (code, type) VALUES (?, ?)', [code, type], (err, results) => {
        if (err) {
            console.error('Error adding toast type:', err);
            return res.status(500).send('Error adding toast type');
        }
        res.json({ success: true, message: 'Toast type added' });
    });
});


// Remove a toast type
app.post('/api/remove-toast-type', (req, res) => {
    const { id } = req.body;
    executeQuery('UPDATE toast_types SET available = FALSE WHERE id = ?', [id], (err, results) => {
        if (err) return res.status(500).send('Error removing toast type');
        res.json({ success: true, message: 'Toast type removed' });
    });
});


app.get('/5min-average', (req, res) => {
    executeQuery(
        'SELECT AVG(TIMESTAMPDIFF(SECOND, created_at, served_at)) AS average_serve_time FROM served_orders WHERE served_at >= NOW() - INTERVAL 5 MINUTE',
        (err, results) => {
            if (err) {
                console.error('Error calculating 5-min average serve time:', err);
                return res.status(500).send('Error calculating average serve time');
            }

            const averageServeTime = results[0].average_serve_time;
            res.json({ averageServeTime: averageServeTime || 0 }); // Send 0 if no data is available
        }
    );
});

const port = 3000;
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});