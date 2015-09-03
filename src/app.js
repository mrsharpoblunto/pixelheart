import express from 'express';
import bodyParser from 'body-parser';
import morgan from 'morgan';
import winston from 'winston';
import compression from 'compression';
import path from 'path';
import constants from './constants';
import configureRoutes from './server-routes'

var app = express();
app.set('port', process.env.PORT || constants.APP_PORT);
app.logger = new (winston.Logger)({
    transports: [
        new winston.transports.Console({
            handleExceptions: true,
            level: process.env.NODE_ENV === 'production' ? 'error' : 'debug'
        })
    ]
});

var winstonStream = {
    write: function(message,encoding) {
        app.logger.info(message);
    }
};
app.use(morgan('combined',{stream: winstonStream}));

if (process.env.NODE_ENV==='production') {
    app.logger.info('Configuring application for production');
    app.enable('trust proxy');
} else {
    app.logger.info('Configuring application for development');
}

app.use(compression());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname,'../public'),
{
    maxAge: constants.RESOURCE_CACHE_TIME * 1000,
    lastModified: false,
}));

configureRoutes(app);

var server = app.listen(app.get('port'),function() {
    app.logger.info('Express server listening on port '+ app.get('port'));
});

// gracefully shutdown on receipt of SIGTERM
process.on('SIGTERM',function() {
    app.logger.info('SIGTERM recieved, draining connections');
    server.close(function() {
        app.logger.info('Express server shutdown successfully');
        process.exit(0);
    });
});
