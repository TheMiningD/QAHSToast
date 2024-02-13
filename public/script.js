// Replace with your client ID and secret
const clientId = '723e091e8ce041a583e556de06350e0b';
const clientSecret = 'a1db766b056a403fbeefd6469ef6c25a';
let selectedSong = null;


async function getToken() {
    const result = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + btoa(clientId + ':' + clientSecret)
        },
        body: 'grant_type=client_credentials'
    });

    const data = await result.json();
    return data.access_token;
}

async function searchSong() {
    const query = document.getElementById('song-search-input').value;
    if (!query) return;

    console.log(`Searching for: ${query}`); // Log the search query
    showLoading(); // Show loading animation

    try {
        const token = await getToken();
        console.log('Token received:', token); // Log the received token

        // Fetch the first 9 songs from Spotify
        console.log('Fetching songs from Spotify...');
        const response = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=9`, {
            method: 'GET',
            headers: { 'Authorization': 'Bearer ' + token }
        });

        const data = await response.json();
        const songs = data.tracks.items
        songs.forEach(track => {
                    console.log(`Track: ${track.name}, Album: ${track.album.name}, Artist: ${track.artists.map(artist => artist.name).join(', ')}`);
                });

        // Filter out explicit tracks and log them
        const nonExplicitTracks = data.tracks.items.filter(track => !track.explicit);
        console.log('Non-explicit tracks:', nonExplicitTracks);

        // Display only the first 5 non-explicit tracks and log them
        const topFiveTracks = nonExplicitTracks.slice(0, 5);
        console.log('Top 5 non-explicit tracks:', topFiveTracks);

        displayResults(topFiveTracks);

    } catch (error) {
        console.error('Error during song search:', error);
    } finally {
        hideLoading(); // Hide loading animation
        console.log('Loading finished.');
    }
}



function showLoading() {
    document.getElementById('loading').style.display = 'block';
}

function hideLoading() {
    document.getElementById('loading').style.display = 'none';
}


function displayResults(tracks) {
    const resultsDiv = document.getElementById('results');
    resultsDiv.innerHTML = '';

    tracks.forEach((track) => {
        const trackDiv = document.createElement('div');
        trackDiv.classList.add('track');

        // Album Art
        const albumArt = document.createElement('img');
        if (track.album.images.length > 0) {
            albumArt.src = track.album.images[0].url;
            albumArt.alt = 'Album Art';
        }

        // Track Info
        const trackInfo = document.createElement('div');
        const trackName = document.createElement('div');
        trackName.textContent = track.name;
        trackName.classList.add('track-name');

        const artistName = document.createElement('div');
        artistName.textContent = track.artists.map(artist => artist.name).join(', ');
        artistName.classList.add('artist-name');

        trackInfo.appendChild(trackName);
        trackInfo.appendChild(artistName);

        trackDiv.appendChild(albumArt);
        trackDiv.appendChild(trackInfo);

        trackDiv.onclick = () => selectSong(track, trackDiv);

        resultsDiv.appendChild(trackDiv);
    });
}

function selectSong(track, divElement) {
    // Deselect the previously selected song, if any
    const previouslySelected = document.querySelector('.selected');
    if (previouslySelected) {
        previouslySelected.classList.remove('selected');
    }

    // Set the selected song and add the 'selected' class to the clicked element
    selectedSong = { track, element: divElement };
    divElement.classList.add('selected');
}

async function queueSelectedSong() {
    if (!selectedSong) return;

    // Send the selected song's ID to the server to add it to the Spotify playlist
    await addSongToPlaylist(selectedSong.track.id);

    // Wait for the queue ID (position) to be found before redirecting
    try {
        let qID = await findSongPositionInQueueFromServer(selectedSong.track.id);
        // Reset the selection
        selectedSong.element.classList.remove('selected');
        selectedSong = null;
        // Redirect to index.html with the queue position
        window.location.href = `index.html?queued=true&position=${qID}`;
    } catch (error) {
        console.error('Error:', error);
        // Handle error, maybe redirect with an error message instead
        window.location.href = 'index.html?error=queueError';
    }
}

async function findSongPositionInQueueFromServer(trackId) {
    try {
        const response = await fetch(`/findPositionInQueue/${trackId}`);
        if (!response.ok) {
            throw new Error('Failed to find song position in queue');
        }
        const data = await response.json();
        if (data.position === -1) {
            console.log('Song not found in queue.');
            return -1;
        } else {
            console.log(`Song is at position ${data.position} in the queue.`);
            return data.position;
        }
    } catch (error) {
        console.error('Error:', error);
        return -1;
    }
}




async function addSongToPlaylist(trackId) {
    try {
        const response = await fetch('/add-to-playlist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trackId: trackId })
        });

        if (response.ok) {
            console.log('Song added to playlist');
        } else {
            console.error('Failed to add song to playlist');
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

