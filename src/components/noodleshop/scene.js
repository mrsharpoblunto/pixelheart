import React from 'react';
import Scene from '../scene';

export default class NoodleShopScene extends Scene {
    constructor(props) {
        super(props);
    }
    init(e,cb) {
        // initialize the scene
        // fire the callback when all scene assets are loaded
        cb();
    }
    update(e) {
        // update the scene each frame
    }
    renderScene(e) {
        // render the scene
    }
};
