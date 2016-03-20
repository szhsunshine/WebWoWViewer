
import adtObjectFactory from './../objects/adtObject.js';
import adtM2ObjectFactory from './../objects/adtM2Object.js';
import wmoM2ObjectFactory from './../objects/wmoM2ObjectFactory.js';
import wmoObjectFactory from './../objects/wmoObjectFactory.js';

import mathHelper from './../math/mathHelper.js';

import config from './../../services/config.js';

import {mat4} from 'gl-matrix';



class InstanceManager {
    constructor(sceneApi) {
        this.sceneApi = sceneApi;
        this.mdxObjectList = [];
        this.sceneObjNumMap = {};
        this.lastUpdatedNumber = 0;
    }

    addMDXObject(MDXObject) {
        if (this.sceneObjNumMap[MDXObject.sceneNumber]) return; // The object has already been added to this manager

        this.sceneObjNumMap[MDXObject.sceneNumber] = MDXObject;
        this.mdxObjectList.push(MDXObject);
    }
    updatePlacementVBO() {
        var gl = this.sceneApi.getGlContext();

        //var buffer = new Array(this.mdxObjectList.length * 16);
        var permanentBuffer = this.permanentBuffer;
        if (!permanentBuffer || permanentBuffer.length != this.mdxObjectList.length * 16) {
            permanentBuffer = new Float32Array(this.mdxObjectList.length * 16);
            this.permanentBuffer = permanentBuffer;
        }

        var paramsVbo = this.placementVBO;
        if (!paramsVbo) {
            paramsVbo = gl.createBuffer();
        }

        for (var i = 0; i < this.mdxObjectList.length; i++) {
            var mdxObject = this.mdxObjectList[i];
            var placementMatrix = mdxObject.placementMatrix;
            //for (var j = 0; j < 16; j++) {
            //    buffer[i*16+j] = placementMatrix[j];
            //}
            //gl.bufferSubData( gl.ARRAY_BUFFER, i*16, placementMatrix);
            permanentBuffer.set(placementMatrix, i * 16);

        }

        gl.bindBuffer(gl.ARRAY_BUFFER, paramsVbo);
        gl.bufferData(gl.ARRAY_BUFFER, permanentBuffer, gl.DYNAMIC_DRAW);
        this.placementVBO = paramsVbo;
        this.lastUpdatedNumber = this.mdxObjectList.length;
    }
    drawInstancedNonTransparentMeshes() {
        if (!this.mdxObjectList[0]) return;

        this.mdxObjectList[0].drawInstancedNonTransparentMeshes(this.lastUpdatedNumber, this.placementVBO, this.dinamycParams);
    }
    drawInstancedTransparentMeshes() {
        if (!this.mdxObjectList[0]) return;

        this.mdxObjectList[0].drawInstancedTransparentMeshes(this.lastUpdatedNumber, this.placementVBO, this.dinamycParams);
    }
}


class GraphManager {
    constructor(sceneApi) {
        this.sceneApi = sceneApi;
        this.m2Objects = [];
        this.instanceList = {};
        this.wmoObjects = [];
        this.adtObjects = [];
        this.skyDom = null;
        this.currentTime = 0;
        this.lastTimeSort = 0;
        this.globalM2Counter = 0;
    }

    addAdtM2Object(doodad) {
        var adtM2 = new adtM2ObjectFactory(this.sceneApi);
        adtM2.load(doodad, false);
        adtM2.sceneNumber = this.globalM2Counter++;
        this.m2Objects.push(adtM2);
        return adtM2;
    }
    addWmoM2Object(doodadDef, placementMatrix, useLocalLighting) {
        var wmoM2Object = new wmoM2ObjectFactory(this.sceneApi);
        var promise = wmoM2Object.load(doodadDef, placementMatrix, useLocalLighting);

        wmoM2Object.sceneNumber = this.globalM2Counter++;
        this.m2Objects.push(wmoM2Object);

        return promise.then(function success() {
            return wmoM2Object;
        }, function error() {
        });
    }
    addWmoObject(wmoDef) {
        var wmoObject = new wmoObjectFactory(this.sceneApi);
        wmoObject.load(wmoDef);
        this.wmoObjects.push(wmoObject);
        return wmoObject;
    }
    addADTObject(fileName) {
        var adtObject = new adtObjectFactory(this.sceneApi);
        adtObject.load(fileName);
        this.adtObjects.push(adtObject);
    }
    addM2ObjectToInstanceManager(m2Object, newBucket) {
        var fileIdent = m2Object.getFileNameIdent();
        var instanceManager = this.instanceList[fileIdent];
        //1. Create Instance manager for this type of file if it was not created yet
        if (!instanceManager) {
            instanceManager = new InstanceManager(this.sceneApi);
            this.instanceList[fileIdent] = instanceManager;
        }

        //2. Add object to instance
        instanceManager.addMDXObject(m2Object, newBucket);

        //3. Assign instance to object
        m2Object.instanceManager = instanceManager;
    }
    setCameraPos(position) {
        this.position = position;
    }
    setLookAtMat(lookAtMat) {
        this.lookAtMat = lookAtMat;
    }
    collectMeshes() {
        var meshesList = [];
        for (var i = 0; i < this.m2Objects.length; i++) {
            var meshes = this.m2Objects[i].getMeshesToRender();
            meshesList = meshesList.concat(meshes);
        }

        //Filter transparent and non transparent meshes
        var nonTransparentMeshes = meshesList.filter(function (a) {
            return a && !a.isTransparent;
        });
        var transparentMeshes = meshesList.filter(function (a) {
            return a && a.isTransparent;
        });

        //TODO: figure out how instancing and mesh sorting shall meet the "from farthest to nearest" requirement for transparent meshes
        //Sort meshes
        nonTransparentMeshes.sort(function (a, b) {
            return a.m2Object == b.m2Object ? 0 : 1;
        });
        nonTransparentMeshes.sort(function (a, b) {
            return (a.m2Object == b.m2Object && a.skin == b.skin) ? 0 : 1;
        });
        nonTransparentMeshes.sort(function (a, b) {
            return (a.m2Object == b.m2Object && a.skin == b.skin && a.meshIndex == b.meshIndex) ? 0 : b.meshIndex - a.meshIndex;
        });

        transparentMeshes.sort(function (a, b) {

        });

        this.nonTransparentM = nonTransparentMeshes;
        this.transparentM = transparentMeshes;
    }
    checkCulling(frustumMat, lookAtMat4) {
        for (var j = 0; j < this.m2Objects.length; j++) {
            this.m2Objects[j].setIsRendered(true);
        }

        if (this.currentInteriorGroup >= 0 && config.getUsePortalCulling()) {
            for (var j = 0; j < this.m2Objects.length; j++) {
                this.m2Objects[j].setIsRendered(true);
            }
            for (var i = 0; i < this.wmoObjects.length; i++) {
                this.wmoObjects[i].resetDrawnForAllGroups(true);
            }
            //TODO: set not render for adt too
            //Cull with normal portals
            this.checkNormalFrustumCulling(frustumMat, lookAtMat4);

            var combinedMat4 = mat4.create();
            mat4.multiply(combinedMat4, frustumMat, lookAtMat4);
            var frustumPlanes = mathHelper.getFrustumClipsFromMatrix(combinedMat4);

            //Travel through portals
            this.currentWMO.transverseInteriorWMO(this.currentInteriorGroup, this.position, frustumMat, lookAtMat4, frustumPlanes);
            this.currentWMO.transverseExteriorWMO(frustumMat, lookAtMat4)

        } else {
            this.checkNormalFrustumCulling(frustumMat, lookAtMat4)
        }

    }
    checkNormalFrustumCulling(frustumMat, lookAtMat4) {
        /*1. Extract planes */
        var combinedMat4 = mat4.create();
        mat4.multiply(combinedMat4, frustumMat, lookAtMat4);
        var frustumPlanes = mathHelper.getFrustumClipsFromMatrix(combinedMat4);

        /* 1. First check wmo's */
        /* Checking group wmo will significatly decrease the amount of m2wmo */
        for (var i = 0; i < this.wmoObjects.length; i++) {
            this.wmoObjects[i].resetDrawnForAllGroups(true);
            this.wmoObjects[i].checkFrustumCulling(this.position, frustumMat, lookAtMat4, frustumPlanes); //The travel through portals happens here too
            this.wmoObjects[i].setIsRenderedForDoodads();
        }

        /* 2. If m2Object is renderable after prev phase - check it against frustrum */
        for (var j = 0; j < this.m2Objects.length; j++) {
            if (this.m2Objects[j].getIsRendered()) {
                this.m2Objects[j].checkFrustumCullingAndSet(this.position, frustumPlanes);
            }
        }

        /* 3. Additionally check if distance to object is more than 100 time of it's diameter */
        for (var j = 0; j < this.m2Objects.length; j++) {
            var currentObj = this.m2Objects[j];
            if (currentObj.getIsRendered()) {
                currentObj.setIsRendered(currentObj.getDiameter() * 100 > currentObj.getCurrentDistance());
            }
        }
    }
    checkAgainstDepthBuffer(frustrumMat, lookAtMat4, depth, width, height) {
        //CompressDepthBuffer 8 times
        function getDepth(x, y) {
            var index = (y * width + x);
            var depth_val = 1.0 - (depth[index]);
            return depth_val;
        }

        var comp_w = Math.floor(width / 8);
        var comp_h = Math.floor(height / 8);
        var compressedDepth = new Float32Array(comp_w * comp_h);

        for (var x = 0; x < comp_w; x++) {
            var min_x1 = x * 8;
            var max_x1 = Math.min((x + 1) * 8, width);

            for (var y = 0; y < comp_h; y++) {
                var max_depth = 1.0;

                var min_y1 = y * 8;
                var max_y1 = Math.min((y + 1) * 8, height);

                for (var x1 = min_x1; x1 < max_x1; x1++) {
                    for (var y1 = min_y1; y1 < max_y1; y1++) {
                        max_depth = Math.min(getDepth(x1, y1), max_depth);
                    }
                }

                compressedDepth[x * comp_w + y] = max_depth;
            }
        }

        function getDepthComp(x, y) {
            var index = x * comp_w + y;
            var depth_val = compressedDepth[index];
            return depth_val;
        }

        function checkDepth(min_x, max_x, min_y, max_y, depth) {
            if (depth < 0)
                return false;

            min_x = (min_x + 1) / 2;
            max_x = (max_x + 1) / 2;
            min_y = (min_y + 1) / 2;
            max_y = (max_y + 1) / 2;

            min_x = Math.floor(min_x * comp_w);
            max_x = Math.floor(max_x * comp_w);

            min_y = Math.floor(min_y * comp_h);
            max_y = Math.floor(max_y * comp_h);

            var isInScreen = false;
            for (var x = min_x; x <= max_x; x++) {
                for (var y = min_y; y <= max_y; y++) {
                    if (getDepthComp(x, y) < depth) {
                        isInScreen = true;
                        return true;
                    }
                }
            }

            return false;
        }

        /* 1. If m2Object is renderable after frustrum culling - check it against depth checking*/
        for (var j = 0; j < this.m2Objects.length; j++) {
            if (this.m2Objects[j].getIsRendered()) {
                this.m2Objects[j].checkAgainstDepthBuffer(frustrumMat, lookAtMat4, checkDepth);
            }
        }
    }
    update(deltaTime) {
        //1. Update all wmo and m2 objects
        var i;
        if (config.getRenderM2()) {
            for (i = 0; i < this.m2Objects.length; i++) {
                this.m2Objects[i].update(deltaTime, this.position);
            }
        }

        for (i = 0; i < this.wmoObjects.length; i++) {
            this.wmoObjects[i].update(deltaTime);
        }

        //Sort every 500 ms
        if (this.currentTime + deltaTime - this.lastTimeSort > 500) {
            var self = this;
            //Sort by m2 and skin files and collect it into instances

            /*
             this.m2Objects.sort(function (a, b) {
             return a.getFileNameIdent() < b.getFileNameIdent() ? -1 :
             (a.getFileNameIdent() > b.getFileNameIdent() ? 1 : 0);
             });


             var lastObject = this.m2Objects[0];
             var lastInstanced = false;
             for (var j = 1; j < this.m2Objects.length; j++) {

             var currentObject = this.m2Objects[j];
             var newBucket = !lastInstanced;
             if (currentObject.getFileNameIdent() == lastObject.getFileNameIdent()) {
             this.addM2ObjectToInstanceManager(lastObject, newBucket);
             lastInstanced = true;
             } else if (lastInstanced) {
             this.addM2ObjectToInstanceManager(lastObject, newBucket);
             lastInstanced = false;
             }

             lastObject = currentObject;
             }
             */

            for (var j = 0; j < this.m2Objects.length; j++) {
                this.m2Objects[j].calcDistance(self.position);
            }

            //Sort by distance
            this.m2Objects.sort(function (a, b) {
                return b.getCurrentDistance() - a.getCurrentDistance() > 0 ? 1 : -1;
            });
        }
        //Update placement matrix buffers

        if (this.currentTime + deltaTime - this.lastTimeSort > 1000) {
            for (var fileIdent in this.instanceList) {
                var instanceManager = this.instanceList[fileIdent];
                instanceManager.updatePlacementVBO();
            }
        }


        //N. Collect non transparent and transparent meshes
        //this.collectMeshes();

        //Check what WMO instance we're in
        this.currentInteriorGroup = -1;
        this.currentWMO = null;
        var bspNodeId = -1;
        var interiorGroupNum = -1
        for (var i = 0; i < this.wmoObjects.length; i++) {
            var result = this.wmoObjects[i].isInsideInterior(this.position);
            interiorGroupNum = result.groupId;

            if (interiorGroupNum >= 0) {
                this.currentWMO = this.wmoObjects[i];
                this.currentInteriorGroup = interiorGroupNum;
                bspNodeId = result.nodeId
                break;
            }
        }

        this.currentTime = this.currentTime + deltaTime;
        return {interiorGroupNum: interiorGroupNum, nodeId: bspNodeId};
    }
    draw() {
        //1. Draw ADT
        this.sceneApi.shaders.activateAdtShader();
        for (var i = 0; i < this.adtObjects.length; i++) {
            this.adtObjects[i].draw();
        }

        //2.0. Draw WMO bsp highlighted vertices
        if (config.getRenderBSP()) {
            this.sceneApi.shaders.activateDrawPortalShader();
            for (var i = 0; i < this.wmoObjects.length; i++) {
                this.wmoObjects[i].drawBspVerticles();
            }
        }

        //2. Draw WMO
        this.sceneApi.shaders.activateWMOShader();
        for (var i = 0; i < this.wmoObjects.length; i++) {
            this.wmoObjects[i].draw();
        }
        this.sceneApi.shaders.deactivateWMOShader();


        //3. Draw background WDL

        //4. Draw skydom
        if (this.skyDom) {
            this.skyDom.draw();
        }


        //5. Draw nontransparent meshes of m2
        if (config.getRenderM2()) {
            this.sceneApi.shaders.activateM2Shader();
            for (var i = 0; i < this.m2Objects.length; i++) {
                if (this.m2Objects[i].instanceManager) continue;
                if (!this.m2Objects[i].getIsRendered()) continue;
                if (!this.m2Objects[i].aabb) continue;

                this.m2Objects[i].drawNonTransparentMeshes();
            }
            this.sceneApi.shaders.deactivateM2Shader();
        }

        //6. Draw WMO portals
        if (config.getRenderPortals()) {
            this.sceneApi.shaders.activateDrawPortalShader();
            for (var i = 0; i < this.wmoObjects.length; i++) {
                this.wmoObjects[i].drawPortals();
            }
        }


        /*
         //5.1 Draw instanced nontransparent meshes of m2
         this.sceneApi.shaders.activateM2InstancingShader();
         for (var fileIdent in this.instanceList) {
         var instanceManager = this.instanceList[fileIdent];
         instanceManager.drawInstancedNonTransparentMeshes();
         }
         this.sceneApi.shaders.deactivateM2InstancingShader();

         //6.1 Draw transparent meshes of m2
         this.sceneApi.shaders.activateM2InstancingShader();
         for (var fileIdent in this.instanceList) {
         var instanceManager = this.instanceList[fileIdent];
         instanceManager.drawInstancedTransparentMeshes();
         }
         this.sceneApi.shaders.deactivateM2InstancingShader();
         */

        //6. Draw transparent meshes of m2
        if (config.getRenderM2()) {
            this.sceneApi.shaders.activateM2Shader();
            for (var i = 0; i < this.m2Objects.length; i++) {
                if (this.m2Objects[i].instanceManager) continue;
                if (!this.m2Objects[i].getIsRendered()) continue;
                if (!this.m2Objects[i].aabb) continue;

                this.m2Objects[i].drawTransparentMeshes();
            }
            this.sceneApi.shaders.deactivateM2Shader();
        }


        //7. Draw BBs
        this.sceneApi.shaders.activateBoundingBoxShader();
        //7.1 Draw M2 BBs
        if (config.getRenderM2()) {
            for (var i = 0; i < this.m2Objects.length; i++) {
                if (!this.m2Objects[i].getIsRendered()) continue;

                this.m2Objects[i].drawBB();
            }
        }

        //7.1 Draw WMO BBs
        for (var i = 0; i < this.wmoObjects.length; i++) {
            this.wmoObjects[i].drawBB();
        }

    }
}

export default GraphManager;