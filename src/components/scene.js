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

        PIXI.SCALE_MODES.DEFAULT = PIXI.SCALE_MODES.NEAREST;
        let container = new PIXI.Container();
        container.scale.x = container.scale.y = 1;

        let renderer = PIXI.autoDetectRenderer(this.props.targetWidth,this.props.targetHeight);

        this.state = {
            _state: INITIAL,
            _accumulatedTime: 0,
            _step: 1000 / this.props.simFps,
            _renderer: renderer,
            container: container
        };
    }
    componentDidMount() {
        this._requestedFrame = window.requestAnimationFrame(this._update);
        let node = React.findDOMNode(this);
        node.appendChild(this.state._renderer.view);

        window.addEventListener('resize',this._resize); 
        this._resize();
    }
    componentWillReceiveProps(nextProps) {
        this.setState({
            _step: 1000 / nextProps.simFps
        });
    }
    componentWillUnmount() {
        if (this._requestedFrame) {
            cancelAnimationFrame(this._requestedFrame);
            this._requestedFrame = 0;
        }
        window.removeEventListener('resize',this._resize);
    }
    render() {
        return <div className='scene__container'>
            <div className={this.state._state === LOADING ? 'scene__loading' : 'scene__loading scene__loading--running'}><h2>Loading...</h2></div>
        </div>;
    }
    _resize = () => {
        let node = React.findDOMNode(this);
        let multiplier = Math.floor(Math.max(1, node.offsetWidth / this.props.targetWidth));
        let width = this.props.targetWidth * multiplier;
        let height = this.props.targetHeight * multiplier;

        this.state._renderer.resize(width,height);
        this.state.container.scale.x = this.state.container.scale.y = multiplier;

        this.setState({
            pixelWidth: width,
            pixelHeight: height,
            pixelMultiplier: multiplier
        });
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
                    container: this.state.container
                },() => {
                    this.setState({ _state: RUNNING });
                });
                break;
            case RUNNING:
                if (!this.update) {
                    console.warn('No update function defined');
                    break;
                }
                if (this.state._last) {
                    let acc = this.state._accumulatedTime + Math.min(1000, t - this.state._last);
                    while (acc > this.state._step) {
                        acc -= this.state._step;
                        // run the current frame 
                        let start = performance.now();
                        this.update({
                            container: this.state.container,
                            delta: this.state._step
                        });
                        let end = performance.now();

                        // ensure we don't enter a perf death spiral if the update
                        // function takes longer than its alloted time
                        if (end - start > this.state._step) {
                            console.warn('Update function could not execute within %d milliseconds', this.state._step);
                            acc = 0;
                            break;
                        }
                    }

                    if (!this.renderScene) {
                        console.warn('No renderScene function defined');
                    } else {
                        this.renderScene({ lerp: Math.min(1, acc / this.state._step) });
                        this.state._renderer.render(this.state.container);
                    }
                    this.setState({ 
                        _accumulatedTime: acc,
                        _last: performance.now()
                    });
                } else {
                    this.setState({ _last: t });
                }
                break;
        }
    }
};
