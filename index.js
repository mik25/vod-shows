const express = require('express');
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const manifest = {
    id: 'com.yourmoviestreamsaddon',
    version: '1.0.0',
    name: 'Your Movies',
    description: 'Movies from streams',
    resources: ['catalog', 'stream', 'meta'],
    types: ['movie'],
    idPrefixes: ['tt'],
    catalogs: [{
        type: 'movie',
        id: 'yourmoviestreams-movies',
        name: 'Your Movies',
        genres: ['All'],
        extra: [
            { name: 'genre' },
            { name: 'skip' },
            { name: 'search' }
        ]
    }]
};

async function isStreamLive(url) {
    try {
        const response = await axios.head(url, { timeout: 3000 });
        console.log(`Checking URL: ${url} - Status: ${response.status}`);
        return response.status === 200;
    } catch (error) {
        console.log(`Error checking URL: ${url} - ${error.message}`);
        return false;
    }
}


const files = fs.readdirSync(__dirname);
const movieFiles = files.filter(file => file.includes('updated_movies') && path.extname(file) === '.json');

if (movieFiles.length === 0) {
    throw new Error("No files with 'updated_movies' found in their names.");
}

const allMovies = [];

for (const movieFile of movieFiles) {
    const movieData = JSON.parse(fs.readFileSync(path.join(__dirname, movieFile), 'utf8'));
    allMovies.push(...movieData);
}

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(args => {
    if (args.type === 'movie' && args.id === 'yourmoviestreams-movies') {
        let metas = allMovies.map(movie => ({
            id: movie.tt_id,
            type: 'movie',
            name: movie.name,
            description: movie.overview,
            aliases: [movie.name]
        }));

        if (args.extra && args.extra.search) {
            const searchTerm = args.extra.search.toLowerCase();
            metas = metas.filter(meta => 
                meta.name.toLowerCase().includes(searchTerm) ||
                (meta.description && meta.description.toLowerCase().includes(searchTerm))
            );
        }

        const page = args.extra && args.extra.page ? parseInt(args.extra.page, 10) : 1;
        const itemsPerPage = 50;

        const startIndex = (page - 1) * itemsPerPage;
        const endIndex = startIndex + itemsPerPage;

        const paginatedMetas = metas.slice(startIndex, endIndex);

        return Promise.resolve({ metas: paginatedMetas });
    } else {
        return Promise.resolve({ metas: [] });
    }
});

builder.defineMetaHandler(args => {
    const matchingMovies = allMovies.filter(movie => movie.tt_id === args.id);
    
    if (matchingMovies.length) {
        const movie = matchingMovies[0];
        return Promise.resolve({
            meta: {
                id: movie.tt_id,
                type: 'movie',
                name: movie.name,
                description: movie.overview
            }
        });
    } else {
        return Promise.resolve({});
    }
});

builder.defineStreamHandler(async args => {
    const matchingMovies = allMovies.filter(movie => movie.tt_id === args.id);
    
    const liveStreams = [];
    for (const movie of matchingMovies) {
        const isLive = await isStreamLive(movie.url);
        if (isLive) {
            liveStreams.push({
                title: movie.name,
                url: movie.url
            });
        }
    }
    
    return { streams: liveStreams };
});

const addonInterface = builder.getInterface();
const app = express();

app.use(cors());
app.use('/', getRouter(addonInterface));

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something went wrong!');
});

const PORT = process.env.PORT || 7001;
app.listen(PORT, () => {
    console.log(`Addon server running on port ${PORT}`);
});
