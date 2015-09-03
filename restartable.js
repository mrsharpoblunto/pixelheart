var spawn = require('child_process').spawn;

function RestartableProcess(processName,args,opts) {
    this._opts = opts || {
        shouldRestart: function() { return true; }
    };
    this._processName = processName;
    this._args = args;
    this._onRestart = null;
    process.on('exit',function() {
        if (this._process) {
            this._process.kill();
        }
    }.bind(this));
};

RestartableProcess.prototype._start = function(cb) {
    this._process = spawn(this._processName,this._args,{stdio:'inherit'});
    this._process.on('close',function(code) {
        this._process = null;
        if (this._onRestart) {
            cb = this._onRestart;
            this._onRestart = null;

            if (this._opts.shouldRestart(code)) {
                this._start(cb);
            } else {
                cb();
            }
        }
    }.bind(this));
    cb();
};

RestartableProcess.prototype.restart = function(cb) {
    if (this._process) {
        this._onRestart = cb;
        this._process.kill();
    } else {
        this._start(cb);
    }
};

module.exports = RestartableProcess;
