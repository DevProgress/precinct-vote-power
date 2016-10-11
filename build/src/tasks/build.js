var gulp = require('gulp-help')(require('gulp'));
var paths = require('../paths');

gulp.task('build-topo', [], function () {
    return gulp.src(paths.data.topo.usTopoData)
        .pipe(gulp.dest(paths.data.topo.dist));
});

gulp.task('build', ['build-usp-2012-counties', 'build-topo'], function () {
});
