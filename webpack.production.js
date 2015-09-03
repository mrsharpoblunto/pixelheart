var webpack = require('webpack');
var path = require('path');

module.exports = {
    debug: false,
    entry: {
        app: path.join(__dirname,'assets/js/app.js'),
        vendor: ['react','react-router']
    },
    output: {
        libraryTarget: 'var',
        library: ['pixelheart','[name]'],
        path: path.join(__dirname,'public'),
        publicPath: '/',
        filename: '[name].js',
    },
    plugins: [
        new webpack.optimize.UglifyJsPlugin({minimize: true}),
        new webpack.DefinePlugin({
            "process.env": {
                NODE_ENV: JSON.stringify("production")
            }
        }),
        new webpack.NoErrorsPlugin(),
        new webpack.optimize.CommonsChunkPlugin('vendor','vendor.js')
    ],
    resolve: {
        extensions: [ '','.js','.jsx']
    },
    module: {
        loaders: [
            { test: /\.jsx?$/, loaders: ['babel?stage=0'], exclude: /node_modules/ },
            { test: /\.js$/, loaders: ['transform/cacheable?brfs'], include: /node_modules\/pixi\.js/ },
            { test: /\.json$/, loader: 'json' }
        ]
    }
};
