var gulp = require('gulp'),
    nano = require('gulp-cssnano'),
    imagemin = require('gulp-imagemin'),
    webpack = require('webpack'),
    devServer = require('webpack-dev-server');
var Restartable = require('./restartable'),
    constants = require('./src/constants');

var args = [];
if (process.env.NODE_ENV !== 'production') {
    args.push('--debug');
}
args.push('index.js');
var node = new Restartable('node',args,{
    shouldRestart: function(code) {
        return code !== 8;
    }
});

var webpackConfig = process.env.NODE_ENV === 'production' ? 
        require('./webpack.production') : 
        require('./webpack.dev');

gulp.task('styles',function() {
    return gulp.src('assets/css/app.css')
               .pipe(nano())
               .pipe(gulp.dest('public'));
});

gulp.task('html',function() {
    return gulp.src('assets/html/**/*')
               .pipe(gulp.dest('public'));
});

gulp.task('fonts',function() {
    return gulp.src('assets/fonts/**/*')
               .pipe(gulp.dest('public/fonts'));
});

gulp.task('images', function() {
    return gulp.src('assets/img/**/*')
               .pipe(imagemin({ optimizationLevel: 5, progressive: true, interlaced: true }))
               .pipe(gulp.dest('public/img'));
});

gulp.task('webpack', function(cb) {
    webpack(webpackConfig, function(err,stats) {
        if (err) {
            return cb(err);
        }
        cb();
    });
});

gulp.task('webpack-dev-server',['server'],function(cb) {
    var compiler = webpack(webpackConfig);
    var server = new devServer(compiler, {
        proxy: {'*': 'http://127.0.0.1:'+constants.APP_PORT},
        publicPath: '/',
        hot: true,
        stats: { colors: true }
    });
    server.listen(constants.WEBPACK_PORT,'0.0.0.0',function() {
        cb();
    });
});

gulp.task('server',function(cb) {
    node.restart(cb);
});

gulp.task('build-common',['styles','images','fonts','html']);
gulp.task('build',['build-common','webpack']);
gulp.task('serverw',['build-common','webpack-dev-server'],function() {
    gulp.watch('assets/css/**/*',['styles']);
    gulp.watch('assets/img/**/*',['images']);
    gulp.watch('assets/fonts/**/*',['fonts']);
    gulp.watch('assets/html/**/*',['html']);
    gulp.watch('src/**/*',['server']);
});
gulp.task('default',['serverw']);
