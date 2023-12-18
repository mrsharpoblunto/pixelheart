import { ReadonlyVec2, vec4 } from "gl-matrix";
import { vec2 } from "gl-matrix";

import { BaseActions, BaseEvents } from "@pixelheart/api";
import {
  DeferredSpriteAnimator,
  DeferredSpriteEffect,
  DeferredSpriteSheet,
  DeferredSpriteTextures,
} from "@pixelheart/effects/deferred-sprite-effect";
import { SolidEffect } from "@pixelheart/effects/solid-effect";
import {
  SimpleSpriteEffect,
  SimpleSpriteSheet,
} from "@pixelheart/effects/sprite-effect";
import { MapContainer, MapTileSource } from "@pixelheart/map";
import { ResourceLoader } from "@pixelheart/resource-loader";

import { NearestBlurEffect } from "./client/nearest-blur";
import { WaterEffect } from "./client/water-effect";

export interface PersistentState {
  version: number;
  character: {
    position: [number, number];
    direction: string;
  };
}

export interface GameState {
  spriteEffect: DeferredSpriteEffect;
  simpleSpriteEffect: SimpleSpriteEffect;
  solidEffect: SolidEffect;
  resources: ResourceLoader<{
    ui: SimpleSpriteSheet;
    map: MapContainer<DeferredSpriteTextures>;
    character: {
      sprite: DeferredSpriteSheet;
      animator: DeferredSpriteAnimator;
      position: vec2;
      relativePosition: vec2;
      speed: number;
      boundingBox: vec4;
    };
  }>;
  screen: {
    absolutePosition: vec2;
  };
  animationTimer: number;
  waterEffect: WaterEffect;
  blurEffect: NearestBlurEffect;
  editor?: EditorState;
  moveTouch: { id: number; startPosition: ReadonlyVec2 } | null;
}

export type EditorEvents = BaseEvents;

export type EditorActions =
  | BaseActions
  | {
      type: "TILE_CHANGE";
      x: number;
      y: number;
      map: string;
      value: MapTileSource;
    };

export interface PersistentEditorState {
  version: number;
  active: boolean;
  panels: { [key: string]: string };
}

export interface EditorState {
  active: boolean;
  newValue: string | null;
  pendingChanges: Map<string, EditorActions>;
  panels: { [key: string]: string };
}
