'use strict';

(function (window, $, undefined) {
    var mdxObject = angular.module('js.wow.render.mdxObject', []);
    mdxObject.factory("mdxObject", ['$q', '$timeout', '$log', function($q, $timeout, $log) {

        function MDXObject(sceneApi){
            this.sceneApi = sceneApi;
        }
        MDXObject.prototype = {
            sceneApi : null,
            subMeshColors : null,
            load : function (modelName, skinNum, submeshRenderData){
                var self = this;

                var nameTemplate = modelName.split('.')[0];
                var modelFileName = nameTemplate + '.m2';
                var skinFileName = nameTemplate + '00.skin';

                var m2Promise = this.sceneApi.resources.loadM2Geom(modelFileName);
                var skinPromise = this.sceneApi.resources.loadSkinGeom(skinFileName);

                this.fileIdent = modelFileName + " " +skinFileName;

                return $q.all([m2Promise,skinPromise]).then(function(result){
                    var m2Geom = result[0];
                    var skinGeom = result[1];

                    self.m2Geom = m2Geom;
                    self.skinGeom = skinGeom;

                    if (!m2Geom) {
                        $log.log("m2 file failed to load : "+ modelName);
                    } else {
                        var gl = self.sceneApi.getGlContext();
                        //var result = self.createVAO(gl, m2Geom, skinGeom);
                        //self.vao = result.vao;
                        //self.vaoExt = result.ext;

                        self.makeSubmeshArray(m2Geom, skinGeom, submeshRenderData)
                    }
                });
            },
            makeSubmeshArray : function (mdxObject, skinObject, submeshRenderData) {
                var self = this;
                var submeshArray = new Array(15);

                /* 1. Free previous subMeshArray */

                /* 2. Fill the meshArrays */
                if (submeshRenderData) {
                    submeshRenderData.forEach(function (object, index) {
                        submeshArray[index] = {
                            submeshIndex: 0
                            //texture1: {},
                            //texture2: {},
                            //texture3: {}
                        }
                    });
                } else {
                    submeshArray.length = skinObject.skinFile.header.subMeshes.length;
                    for (var i = 0; i < submeshArray.length; i++) {
                        submeshArray[i] = {
                            isRendered: false,
                            isTransparent : false,
                            textureTexUnit1: null,
                            textureTexUnit2: null,
                            textureTexUnit3: null
                        };
                    }

                    for (var i = 0; i < skinObject.skinFile.header.texs.length ; i++) {
                        var skinTextureDefinition = skinObject.skinFile.header.texs[i];
                        var mdxTextureIndex = mdxObject.m2File.texLookup[skinTextureDefinition.textureIndex];
                        var mdxTextureDefinition = mdxObject.m2File.textureDefinition[mdxTextureIndex];

                        var renderFlagIndex = skinTextureDefinition.renderFlagIndex;
                        var isTransparent = mdxObject.m2File.renderFlags[renderFlagIndex].blend >= 2;


                        var submeshData = submeshArray[skinTextureDefinition.submeshIndex];

                        submeshData.isRendered = true;
                        submeshData.isTransparent = isTransparent;

                        /* 2.2. Assign and load textures */
                        if (mdxTextureDefinition.texType === 0) {
                            (function (submeshData, mdxTextureDefinition, textureIndex) {
                                self.sceneApi.resources.loadTexture(mdxTextureDefinition.textureName)
                                    .then(function success(textObject) {
                                        submeshData.texUnit1Texture = textObject;
                                        submeshData.texUnit1TexIndex = textureIndex;

                                    }, function error() {
                                    });
                            })(submeshData, mdxTextureDefinition, i);
                        }
                    }
                }

                this.submeshArray = submeshArray;
            },
            createVAO: function (gl, m2Geom, skinObject){
                var ext = gl.getExtension("OES_vertex_array_object"); // Vendor prefixes may apply!
                if (ext) {
                    var vao = ext.createVertexArrayOES();
                    ext.bindVertexArrayOES(vao);

                    m2Geom.setupAttributes(gl, skinObject);

                    ext.bindVertexArrayOES(null);
                }

                return {vao : vao, ext : ext};
            },
            getSubMeshColor : function (deltaTime) {
                var colors = this.m2Geom.m2File.colors;
                if (colors.length > 0) {
                    var result = new Array(colors.length);

                    for (var i = 0; i < colors.length; i++) {
                        var vector = colors[i].color.valuesPerAnimation[0][0];
                        var alpha = colors[i].alpha.valuesPerAnimation[0][0];

                        result[i] = [vector.x, vector.y, vector.z, alpha/32767];
                    }

                    return result;

                } else {
                    return null;
                }
            },
            getMeshesToRender : function() {
                var meshesToRender = [];
                if (this.submeshArray) {
                    for (var i = 0; i < this.submeshArray.length; i++) {
                        if (!this.submeshArray[i].isRendered) continue;
                        if (this.submeshArray[i].texUnit1TexIndex === undefined) continue;

                        var colorIndex = this.skinGeom.skinFile.header.texs[this.submeshArray[i].texUnit1TexIndex].colorIndex;
                        var renderFlagIndex = this.skinGeom.skinFile.header.texs[this.submeshArray[i].texUnit1TexIndex].renderFlagIndex;
                        var isTransparent = this.m2Geom.m2File.renderFlags[renderFlagIndex].blend > 0;
                        var meshColor = (colorIndex > -1 && this.subMeshColors) ? this.subMeshColors[colorIndex] : null;

                        var mesh = {
                            m2Object: this,
                            skin: this.skinGeom,
                            meshIndex: i,
                            color: meshColor,
                            transparency: 0,
                            isTransparent: isTransparent,
                            animationMatrix: null
                        };

                        meshesToRender.push(mesh);
                    }
                }

                return meshesToRender;
            },
            getBoundingBox : function () {
                if (!this.m2Geom) return null;

                return {
                    ab : this.m2Geom.m2File.BoundingCorner1,
                    cd : this.m2Geom.m2File.BoundingCorner2
                }
            },
            update : function(deltaTime) {
                if (!this.m2Geom) return;

                var subMeshColors = this.getSubMeshColor(deltaTime);
                this.subMeshColors = subMeshColors;
            },
            drawInstancedNonTransparentMeshes : function (instanceCount, placementVBO, color) {
                if (!this.m2Geom) return;

                this.m2Geom.setupAttributes(this.skinGeom);
                //this.m2Geom.setupUniforms(placementMatrix);
                this.m2Geom.setupPlacementAttribute(placementVBO);

                var colorVector = [color&0xff, (color>> 8)&0xff,
                    (color>>16)&0xff, (color>> 24)&0xff];
                colorVector[0] /= 255.0; colorVector[1] /= 255.0;
                colorVector[2] /= 255.0; colorVector[3] /= 255.0;

                for (var i = 0; i < this.submeshArray.length; i++) {
                    var subMeshData = this.submeshArray[i];
                    if (subMeshData.isTransparent) continue;

                    this.m2Geom.drawMesh(i, subMeshData, this.skinGeom, this.subMeshColors, colorVector, instanceCount)
                }
            },
            drawInstancedTransparentMeshes : function (instanceCount, placementVBO, color) {
                if (!this.m2Geom) return;

                this.m2Geom.setupAttributes(this.skinGeom);
                //this.m2Geom.setupUniforms(placementMatrix);
                this.m2Geom.setupPlacementAttribute(placementVBO);

                var colorVector = [color&0xff, (color>> 8)&0xff,
                    (color>>16)&0xff, (color>> 24)&0xff];
                colorVector[0] /= 255.0; colorVector[1] /= 255.0;
                colorVector[2] /= 255.0; colorVector[3] /= 255.0;

                for (var i = 0; i < this.submeshArray.length; i++) {
                    var subMeshData = this.submeshArray[i];
                    if (!subMeshData.isTransparent) continue;

                    this.m2Geom.drawMesh(i, subMeshData, this.skinGeom, this.subMeshColors, colorVector, instanceCount)
                }
            },
            drawNonTransparentMeshes : function (placementMatrix, color) {
                if (!this.m2Geom) return;

                this.m2Geom.setupAttributes(this.skinGeom);
                this.m2Geom.setupUniforms(placementMatrix);

                var colorVector = [color&0xff, (color>> 8)&0xff,
                    (color>>16)&0xff, (color>> 24)&0xff];
                colorVector[0] /= 255.0; colorVector[1] /= 255.0;
                colorVector[2] /= 255.0; colorVector[3] /= 255.0;

                for (var i = 0; i < this.submeshArray.length; i++) {
                    var subMeshData = this.submeshArray[i];
                    if (subMeshData.isTransparent) continue;

                    this.m2Geom.drawMesh(i, subMeshData, this.skinGeom, this.subMeshColors, colorVector)
                }
            },
            drawTransparentMeshes : function (placementMatrix, color) {
                if (!this.m2Geom) return;

                this.m2Geom.setupAttributes(this.skinGeom);
                this.m2Geom.setupUniforms(placementMatrix);

                var colorVector = [color&0xff, (color>> 8)&0xff,
                    (color>>16)&0xff, (color>> 24)&0xff];
                colorVector[0] /= 255.0; colorVector[1] /= 255.0;
                colorVector[2] /= 255.0; colorVector[3] /= 255.0;

                for (var i = 0; i < this.submeshArray.length; i++) {
                    var subMeshData = this.submeshArray[i];
                    if (!subMeshData.isTransparent) continue;

                    this.m2Geom.drawMesh(i, subMeshData, this.skinGeom, this.subMeshColors, colorVector)
                }
            },
            draw : function (placementMatrix, color){
                var colorVector = [color&0xff, (color>> 8)&0xff,
                    (color>>16)&0xff, (color>> 24)&0xff];
                colorVector[0] /= 255.0; colorVector[1] /= 255.0;
                colorVector[2] /= 255.0; colorVector[3] /= 255.0;

                if ((this.m2Geom) && (this.skinGeom)) {
                    this.m2Geom.draw(this.skinGeom, this.submeshArray, placementMatrix, colorVector, this.subMeshColors, this.vao, this.vaoExt);
                }
            }
        };

        return MDXObject;
    }]);
})(window, jQuery);