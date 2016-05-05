import React from 'react';
import PIXI from 'pixi.js';

const INITIAL = 0;
const LOADING = 1;
const RUNNING = 2;

export default class Scene extends React.Component {
    static defaultProps = {
        targetWidth: 240,
        targetHeight: 135,
        simFps: 60
    }
    static propTypes = {
        targetWidth: React.PropTypes.number.isRequired,
        targetHeight: React.PropTypes.number.isRequired,
        simFps: React.PropTypes.number
    }
    constructor(props) {
        super(props);

        this.state = {
            _state: INITIAL
        };

        PIXI.SCALE_MODES.DEFAULT = PIXI.SCALE_MODES.NEAREST;

        this._accumulatedTime = 0;
        this._step = 1000 / this.props.simFps;
        this._renderer = PIXI.autoDetectRenderer(this.props.targetWidth,this.props.targetHeight);
        this._container = new PIXI.Container();
    }
    componentDidMount() {
        let node = React.findDOMNode(this);
        node.appendChild(this._renderer.view);

        window.addEventListener('resize',this._resize); 
        this._resize();
        this._requestedFrame = window.requestAnimationFrame(this._update);
    }
    componentWillReceiveProps(nextProps) {
        this._step = 1000 / nextProps.simFps
    }
    componentWillUnmount() {
        if (this._requestedFrame) {
            cancelAnimationFrame(this._requestedFrame);
            this._requestedFrame = 0;
        }
        window.removeEventListener('resize',this._resize);
    }
    render() {
        if (this.state._state === RUNNING) {
            if (!this.beforeRenderScene) {
                console.warn('No beforeRenderScene function defined');
            } else {
                this.beforeRenderScene({ container: this._container });
            }
        }
        return <div className='scene__container'>
            <div className={this.state._state === LOADING ? 'scene__loading' : 'scene__loading scene__loading--running'}><h2>Loading...</h2></div>
        </div>;
    }
    _resize = () => {
        let node = React.findDOMNode(this);
        let multiplier = Math.floor(Math.max(1, node.offsetWidth / this.props.targetWidth));
        let width = this.props.targetWidth * multiplier;
        let height = this.props.targetHeight * multiplier;

        this._renderer.resize(width,height);
        this._container.scale.x = this._container.scale.y = multiplier;
        this.pixelWidth = width;
        this.pixelHeight = height;
        this.pixelMultiplier = multiplier;
    }
    _update = (t) => {
        this._requestedFrame = window.requestAnimationFrame(this._update);

        switch (this.state._state) {
            case INITIAL:
                if (!this.init) {
                    console.warn('No init function defined');
                    break;
                }
                this.setState({ _state: LOADING });
                this.init({
                    container: this._container
                },() => {
                    if (!this.beforeRenderScene) {
                        console.warn('No beforeRenderScene function defined');
                    } else {
                        this.beforeRenderScene({
                            container: this._container
                        });
                    }
                    this.setState({ _state: RUNNING });
                });
                break;
            case RUNNING:
                if (!this.update) {
                    console.warn('No update function defined');
                    break;
                }
                if (this._last) {
                    let acc = this._accumulatedTime + Math.min(1000, t - this._last);
                    while (acc > this._step) {
                        acc -= this._step;
                        // run the current frame 
                        let start = performance.now();
                        this.update({
                            container: this._container,
                            delta: this._step
                        });
                        let end = performance.now();

                        // ensure we don't enter a perf death spiral if the update
                        // function takes longer than its alloted time
                        if (end - start > this._step) {
                            console.warn('Update function could not execute within %d milliseconds', this._step);
                            acc = 0;
                            break;
                        }
                    }

                    if (!this.renderScene) {
                        console.warn('No renderScene function defined');
                    } else {
                        this.renderScene({ lerp: Math.min(1, acc / this._step) });
                        this._renderer.render(this._container);
                    }
                    this._accumulatedTime = acc;
                    this._last = performance.now();
                } else {
                    this._last = t;
                }
                break;
        }
    }
};
