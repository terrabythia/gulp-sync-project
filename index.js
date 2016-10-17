'use strict';
var gulp = require('gulp');
var path = require('path');
var hg = require('hg'),
    HGRepo = hg.HGRepo;
var watch = require('gulp-watch');
var notify = require("gulp-notify");
var clean = require('gulp-clean');
var fs = require('fs');
var recursive = require('recursive-readdir');
var Vinyl = require('vinyl');
var LocalStorage = require('node-localstorage').LocalStorage;

var requiredOptions = [
    'destination'
];

function sync(options) {

    var localStorage = new LocalStorage('./scratch');

    requiredOptions.forEach(function(o) {
        if ('undefined' === typeof options[o]) {
            throw new Error('Option "' + o + '" is required!');
        }
    });

    var extensions = options.extensions ? options.extensions : ['*'];
    var excludePaths = options.excludePaths ? options.excludePaths : [];
    var excludeExtensions = options.excludeExtensions ? options.excludeExtensions : [];

    function handleFile(file, dest, n) {

        if ('undefined' === typeof dest) {
            dest = options.destination;
        }
        if ('undefined' === typeof n) {
            n = true;
        }

        for (var i = 0; i < excludePaths.length; i++) {
            if (file.relative.indexOf(excludePaths[i]) === 0) {
                console.log('ignore: ' + file.relative);
                return;
            }
        }

        if (!file.isDirectory() && excludeExtensions.indexOf(file.extname.replace('.', '')) !== -1) {
            console.log('ignore: ' + file.relative);
            return;
        }

        var relativePath = file.relative,
            dirName = path.dirname(relativePath),
            destinationPath = dest + '/' + file.relative;

        if ('unlink' !== file.event) {
            if (fs.existsSync(destinationPath)) {
                var sourceChangeTime = fs.statSync(file.path).mtime.getTime(),
                    destChangeTime = fs.statSync(destinationPath).mtime.getTime();

                if (destChangeTime > sourceChangeTime || destChangeTime === sourceChangeTime) {
                    if (n) console.log('Destination is newer or same age, so skip: ' + file.relative);
                    return;
                }
            }
        }
        else {
            console.log('unlink: ' + file.relative);
        }

        var task;
        if ('change' === file.event || 'add' === file.event) {
            task = gulp.src(file.path)
                .pipe(gulp.dest(dest + '/' + dirName));
            if (n) {
                task = task.pipe(notify('Copied: ' + file.relative));
            }
            else {
                console.log('Synced: ' + file.relative);
            }
            return task;
        }
        else if ('unlink' === file.event) {
            task = gulp.src(dest + '/' + file.relative)
                .pipe(clean({force: true}));
            if (n) {
                task = task.pipe(notify('Deleted: ' + file.relative));
            }
            else {
                console.log('Deleted: ' + file.relative);
            }
            return task;
        }
    }


    var queue = [];
    var busyInitializing = true;
    var repo = new HGRepo(options.destination);

    var savedRevision = localStorage.getItem('last-hg-update');

    console.log('Checking for updates in remote project...');
    console.log('Saved revision is: ' + (savedRevision ? savedRevision : 'none'));

    function handleQueue() {
        if (queue.length) {
            for (var i = 0; i < queue.length; i++) {
                handleFile(queue[i]);
            }
            queue = [];
        }
    }

    function checkUpdateInRepo() {
        savedRevision = localStorage.getItem('last-hg-update');
        repo.summary(function (err, output) {

            if (err) {
                throw err;
            }

            var revision = 0;
            output.forEach(function (line) {
                if ('string' === typeof line.body && line.body.indexOf('parent:') === 0) {
                    // find parent?
                    var parts = line.body.replace('parent: ', '').split(':'),
                        revision = parseInt(parts[0]);

                    localStorage.setItem('last-hg-update', revision);

                    if (null !== savedRevision && revision > parseInt(savedRevision)) {
                        console.log('You have pulled some changes from the repository since last time, updating...');
                        repo.status({'--rev': savedRevision + ':' + revision}, function (err, output) {
                            output.forEach(function (line) {
                                if (line.body && 'string' === typeof line.body && line.body.trim().length > 1) {
                                    var path = options.destination + '/' + line.body.trim(),
                                        vinyl = new Vinyl({
                                            cwd: options.destination,
                                            path: path
                                        });
                                    vinyl.event = fs.existsSync(path) ? 'change' : 'unlink';
                                    handleFile(vinyl, '.');
                                }
                            });
                            handleQueue();
                            busyInitializing = false;

                            // check for repository updates in 5 seconds again...
                            setTimeout(checkUpdateInRepo, 5000);
                        });
                    }
                    else {
                        console.log('No changes in repo found');
                        handleQueue();
                        busyInitializing = false;

                        // check for repository updates in 5 seconds again...
                        setTimeout(checkUpdateInRepo, 5000);
                    }

                }
            });
        });
    }

    checkUpdateInRepo();

    console.log('watching ' + '**.{' + extensions.join(',') + '}');

    // TODO: unlinken buiten de root werkt niet! :(
    // loop over ALL external AND internal files to check for changes?
    return watch('**.{' + extensions.join(',') + '}', {ignoreInitial: true}, function (file) {

        if (busyInitializing) {
            queue.push(file);
        }
        else {
            handleFile(file);
        }

    });

}

module.exports = sync;