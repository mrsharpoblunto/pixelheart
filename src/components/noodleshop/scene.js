import React from 'react';
import PIXI from 'pixi.js';
import Scene from '../scene';

export default class NoodleShopScene extends Scene {
    constructor(props) {
        super(props);
    }
    init(e,cb) {
        let texture = PIXI.Texture.fromImage('/img/test.png');

        let onComplete = () => {
            let sprite = new PIXI.Sprite(texture);
            sprite.anchor.x = sprite.anchor.y = 0;
            sprite.position.x = sprite.position.y = 0;
            this.state.container.addChild(sprite);
            cb();
        }
        if (!texture.baseTexture.hasLoaded) {
            texture.on('update',() => onComplete());
        } else {
            onComplete();
        }
    }
    update(e) {
        // update the scene each frame
    }
    renderScene(e) {
        // render the scene
    }
};
