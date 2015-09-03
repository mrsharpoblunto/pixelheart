var webpack = require('webpack');
var path = require('path');

module.exports = {
    debug: true,
    devtool: 'source-map',
    entry: {
        app: [
            path.join(__dirname,'assets/css/app.css'),
            'webpack-dev-server/client?',
            'webpack/hot/dev-server',
            path.join(__dirname,'assets/js/app.js')
        ],
        vendor: ['react','react-router']
    },
    output: {
        libraryTarget: 'var',
        library: ['pixelheart','[name]'],
        path: path.join(__dirname,'/public'),
        publicPath: '/',
        filename: "[name].js",
        devtoolModuleFilenameTemplate: '[resource-path]'
    },
    plugins: [
        new webpack.HotModuleReplacementPlugin(),
        new webpack.DefinePlugin({
            "process.env": {
                NODE_ENV: JSON.stringify("debug")
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
            { test: /\.jsx?$/, loaders: ['react-hot','babel?stage=0'], exclude: /node_modules/ },
            { test: /\.css$/, loader: 'style!css?importLoaders=1' }

        ]
    }
};
