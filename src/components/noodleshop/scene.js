import React from 'react';
import PIXI from 'pixi.js';
import Scene from '../scene';

export default class NoodleShopScene extends Scene {
    constructor(props) {
        super(props);
    }
    init(e,cb) {
        // runs only once
        let texture = PIXI.Texture.fromImage('/img/test.png');

        let onComplete = () => {
            this.sprite = new PIXI.Sprite(texture);
            this.blurFilter = new PIXI.filters.BlurFilter();
            e.container.addChild(this.sprite);
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
    beforeRenderScene(e) {
        // executes once after initialization and every time the react component re-renders
        this.sprite.filters = [this.blurFilter];
        this.sprite.anchor.x = this.sprite.anchor.y = 0;
        this.sprite.position.x = this.sprite.position.y = 10;
        this.blurFilter.blur = 10;
        this.blurFilter.passes = 10;
    }
    renderScene(e) {
        // render the scene
    }
};
