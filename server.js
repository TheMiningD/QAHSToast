require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const SpotifyWebApi = require('spotify-web-api-node');
const fs = require('fs');
const fetch = require('node-fetch');
const path = require('path');
const dataFilePath = path.join(__dirname, 'data.json');


const defaultToastTypes = [
    { id: 3, type: "Cinnamon Sugar", available: true, code: "CS" },
    { id: 12, type: "Vegemite", available: true, code: "V" },
    { id: 13, type: "Honey", available: true, code: "H" },
    { id: 16, type: "Raspberry Jam", available: true, code: "RJ" },
    { id: 17, type: "Butter Only", available: true, code: "BO" },
    { id: 18, type: "No Butter (Plain)", available: true, code: "P" }
];

function initializeDataFile() {
    let data;
    // Check if data.json exists
    if (fs.existsSync(dataFilePath)) {
        // Read the existing data
        const fileContent = fs.readFileSync(dataFilePath, 'utf8');
        data = JSON.parse(fileContent);

        // Ensure all default toast types are included
        defaultToastTypes.forEach(defaultType => {
            if (!data.toast_types.some(type => type.id === defaultType.id)) {
                data.toast_types.push(defaultType);
            }
        });

    } else {
        // Initialize data structure if file doesn't exist
        data = {
            orders: [],
            settings: { orderTakingEnabled: "1", orderReadyTime: "300" },
            served_orders: [],
            toast_types: defaultToastTypes
        };
    }

    // Write updated or initial data back to file
    fs.writeFileSync(dataFilePath, JSON.stringify(data, null, 2), 'utf8');
}

const app = express();
app.use(bodyParser.json());

const dataFilePath = 'data.json';

function readData() {
    try {
        const fileContent = fs.readFileSync(dataFilePath, 'utf8');
        return JSON.parse(fileContent);
    } catch (err) {
        console.error('Error reading data file:', err);
        return { orders: [], settings: {}, served_orders: [], toast_types: [] };
    }
}

function writeData(data) {
    try {
        const dataString = JSON.stringify(data, null, 2);
        fs.writeFileSync(dataFilePath, dataString, 'utf8');
    } catch (err) {
        console.error('Error writing data file:', err);
    }
}

const spotifyApi = new SpotifyWebApi({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri: process.env.REDIRECT_URI
});

const playlistId = '7wScP4Wjs5yJ1WLDhdsSI8';
const refreshFilePath = 'refreshToken.json';

async function refreshAccessToken() {
    try {
        console.log('Starting to refresh access token...');
        const fileContent = fs.readFileSync(refreshFilePath, 'utf8');
        const { refresh_token } = JSON.parse(fileContent);
        spotifyApi.setRefreshToken(refresh_token);

        console.log('Calling Spotify API to refresh the token...');
        const data = await spotifyApi.refreshAccessToken();
        console.log('Spotify API response:', data.body);

        spotifyApi.setAccessToken(data.body['access_token']);
        fs.writeFileSync(refreshFilePath, JSON.stringify({ refresh_token }), 'utf8');
        console.log('Access token refreshed and set');
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

        await spotifyApi.addTracksToPlaylist(playlistId, [trackUri]);
        console.log('Track added to playlist', trackId);

        const accessToken = spotifyApi.getAccessToken();
        await addToQueue(trackUri, accessToken);

        res.send('Track added to playlist and queued');
    } catch (err) {
        console.error('Error in adding track to playlist or queuing', err);
        res.status(500).send('Error processing your request');
    }
});

async function addToQueue(trackUri, accessToken) {
    try {
        const response = await fetch(`https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(trackUri)}`, {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + accessToken }
        });

        if (!response.ok) {
            throw new Error(`Failed to queue track: ${response.statusText}`);
        }

        console.log('Track queued successfully');
    } catch (err) {
        console.error('Error adding track to queue', err);
        throw err;
    }
}

app.post('/api/order', (req, res) => {
    const { name, notes } = req.body;
    let orderDetails = {};
    for (const key in req.body) {
        if (key.startsWith('toastType') || key.startsWith('quantity')) {
            orderDetails[key] = req.body[key];
        }
    }

    const data = readData();
    const newOrder = {
        id: data.orders.length + 1,
        name,
        order_details: orderDetails,
        notes
    };
    data.orders.push(newOrder);
    writeData(data);

    res.json({ success: true, orderId: newOrder.id });
});

app.get('/api/orders', (req, res) => {
    const data = readData();
    res.json(data.orders);
});

app.get('/api/order/:orderId', (req, res) => {
    const { orderId } = req.params;
    const data = readData();
    const order = data.orders.find(order => order.id.toString() === orderId);
    if (order) {
        res.json(order);
    } else {
        res.status(404).send('Order not found');
    }
});

app.post('/api/serve-order', (req, res) => {
    const { orderId } = req.body;
    const data = readData();
    const orderIndex = data.orders.findIndex(order => order.id.toString() === orderId);
    if (orderIndex > -1) {
        const [order] = data.orders.splice(orderIndex, 1);
        order.served_at = new Date().toISOString();
        data.served_orders.push(order);
        writeData(data);
        res.json({ success: true, message: 'Order served' });
    } else {
        res.status(404).send('Order not found');
    }
});

app.post('/api/toggle-order-taking', (req, res) => {
    const data = readData();
    // Toggle the orderTakingEnabled setting
    data.settings.orderTakingEnabled = data.settings.orderTakingEnabled === '1' ? '0' : '1';
    writeData(data);
    res.json({ success: true, message: 'Order taking toggled', newValue: data.settings.orderTakingEnabled });
});

app.get('/api/get-order-taking-state', (req, res) => {
    const data = readData();
    res.json({ value: data.settings.orderTakingEnabled || '0' });
});

app.get('/api/toast-types', (req, res) => {
    const data = readData(); // Assume readData() is a function you've already defined to read your JSON data file
    const availableToastTypes = data.toast_types.filter(type => type.available); // Filter for available toast types
    res.json(availableToastTypes);
});



app.use(express.static(path.join(__dirname, 'public')));

const port = 3000;
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
initializeDataFile();

