var gulp = require('gulp-help')(require('gulp'));
var del = require('del');
var paths = require('../paths');
var print = require('gulp-print');

gulp.task('clean', '* Delete trans/compiled output in style, dist, data', function () {
    del(paths.dist, { force: true });
});
