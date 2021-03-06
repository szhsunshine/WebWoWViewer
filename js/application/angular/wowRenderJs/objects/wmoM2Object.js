import MDXObject from './M2Object.js';
import config from './../../services/config.js'
import mathHelper from './../math/mathHelper.js';
import {mat4, vec4, vec3} from 'gl-matrix';

class WmoM2Object extends MDXObject {
    constructor(sceneApi) {
        super(sceneApi);

        var self = this;
        self.sceneApi = sceneApi;
        self.currentDistance = 0;
        self.isRendered = true;
        self.useLocalLighting = true;
        self.wmoObject = null;
    }

    setWmoObject(value) {
        this.wmoObject = value;
    }
    getDiffuseColor() {
        return (this.useLocalLighting) ? this.diffuseColor : new Float32Array([1,1,1,1])
    }
    getInvertModelMatrix() {
        return this.placementInvertMatrix;
    }
    checkFrustumCulling (cameraVec4, frustumPlanes, num_planes) {
        if (!this.loaded) {
            return true;
        }
        var inFrustum = super.checkFrustumCulling(cameraVec4, frustumPlanes, num_planes);
        return inFrustum;
    }
    checkAgainstDepthBuffer(frustumMatrix, lookAtMat4, getDepth) {
        this.setIsRendered(this.getIsRendered() && super.checkAgainstDepthBuffer(frustumMatrix, lookAtMat4, this.placementMatrix, getDepth));
    }

    drawTransparentMeshes () {
        var diffuseColor = this.getDiffuseColor();
        this.draw(true, this.placementMatrix, diffuseColor);
    }
    drawNonTransparentMeshes () {
        var diffuseColor = this.getDiffuseColor();
        this.draw(false, this.placementMatrix, diffuseColor);
    }
    drawInstancedNonTransparentMeshes (instanceCount, placementVBO) {
        this.drawInstanced(false, instanceCount, placementVBO);
    }
    drawInstancedTransparentMeshes (instanceCount, placementVBO) {
        this.drawInstanced(true, instanceCount, placementVBO);
    }
    drawBB () {
        super.drawBB([0.819607843, 0.058, 0.058])
    }

    createPlacementMatrix (doodad, wmoPlacementMatrix){
        var placementMatrix = mat4.create();
        mat4.identity(placementMatrix);
        mat4.multiply(placementMatrix, placementMatrix, wmoPlacementMatrix);

        mat4.translate(placementMatrix, placementMatrix, [doodad.pos.x,doodad.pos.y,doodad.pos.z]);

        var orientMatrix = mat4.create();
        mat4.fromQuat(orientMatrix,
            [doodad.rotation.imag.x,
            doodad.rotation.imag.y,
            doodad.rotation.imag.z,
            doodad.rotation.real]
        );
        mat4.multiply(placementMatrix, placementMatrix, orientMatrix);

        mat4.scale(placementMatrix, placementMatrix, [doodad.scale, doodad.scale, doodad.scale]);

        var placementInvertMatrix = mat4.create();
        mat4.invert(placementInvertMatrix, placementMatrix);

        this.placementInvertMatrix = placementInvertMatrix;
        this.placementMatrix = placementMatrix;
    }
    calcOwnPosition () {
        var position = vec4.fromValues(0,0,0,1 );
        vec4.transformMat4(position, position, this.placementMatrix);

        this.position = position;
    }
    setUseLocalLighting(value) {
        this.useLocalLighting = value;
    }
    getCurrentDistance (){
        return this.currentDistance;
    }
    getDiameter () {
        return this.diameter;
    }
    setIsRendered (value) {
        this.isRendered = value;
    }
    load (doodad, wmoPlacementMatrix, useLocalColor){
        var self = this;

        self.doodad = doodad;

        var color = doodad.color;
        var diffuseColorVec4 = [color&0xff, (color>> 8)&0xff,
            (color>>16)&0xff, (color>> 24)&0xff];
        diffuseColorVec4[0] /= 255.0; diffuseColorVec4[1] /= 255.0;
        diffuseColorVec4[2] /= 255.0; diffuseColorVec4[3] /= 255.0;

        self.diffuseColor = new Float32Array(diffuseColorVec4);


        self.createPlacementMatrix(doodad, wmoPlacementMatrix);
        self.calcOwnPosition();

        return super.setLoadParams(doodad.modelName, 0);
    }
}

export default WmoM2Object;