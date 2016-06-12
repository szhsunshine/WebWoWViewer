import cacheTemplate from './../cache.js';
import mdxLoader from './../../services/map/mdxLoader.js';


class M2Geom {
    constructor(sceneApi) {
        this.sceneApi = sceneApi;
        this.gl = sceneApi.getGlContext();
        this.combinedVBO = null;
        this.vao = null;
        this.textureArray = []
    }

    assign(m2File) {
        this.m2File = m2File;
    }

    loadTextures() {
        var textureDefinition = this.m2File.textureDefinition;

        for (var i = 0; i < textureDefinition.length; i++) {
            this.loadTexture(i, textureDefinition[i].textureName);
        }
    }

    loadTexture(index, filename) {
        var self = this;
        this.sceneApi.resources.loadTexture(filename).then(function success(textObject) {
            self.textureArray[index] = textObject;
        }, function error() {
        });
    }

    createVBO() {
        var gl = this.gl;
        var m2Object = this.m2File;

        this.vertexVBO = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexVBO);
        gl.bufferData(gl.ARRAY_BUFFER, m2Object.vertexes, gl.STATIC_DRAW);

        /* Index is taken from skin object */
    }
    createVAO(skinObject){
        var gl = this.gl;
        var shaderAttributes = this.sceneApi.shaders.getShaderAttributes();
        var vao_ext = this.sceneApi.extensions.getVaoExt();

        if (vao_ext) {
            var vao = vao_ext.createVertexArrayOES();
            vao_ext.bindVertexArrayOES(vao);

            this.sceneApi.shaders.activateM2Shader();
            this.sceneApi.shaders.activateM2ShaderAttribs();
            this.setupAttributes(skinObject);
            vao_ext.bindVertexArrayOES(null);
            this.sceneApi.shaders.deactivateM2Shader();

            this.vao = vao;
        }
    }

    setupPlacementAttribute(placementVBO) {
        var gl = this.gl;
        var shaderAttributes = this.sceneApi.shaders.getShaderAttributes();

        gl.bindBuffer(gl.ARRAY_BUFFER, placementVBO);

        //"Official" way to pass mat4 to shader as attribute
        gl.vertexAttribPointer(shaderAttributes.uPlacementMat + 0, 4, gl.FLOAT, false, 16 * 4, 0);  // position
        gl.vertexAttribPointer(shaderAttributes.uPlacementMat + 1, 4, gl.FLOAT, false, 16 * 4, 16);  // position
        gl.vertexAttribPointer(shaderAttributes.uPlacementMat + 2, 4, gl.FLOAT, false, 16 * 4, 32);  // position
        gl.vertexAttribPointer(shaderAttributes.uPlacementMat + 3, 4, gl.FLOAT, false, 16 * 4, 48);  // position
    }


    setupAttributes(skinObject) {
        var gl = this.gl;
        var shaderAttributes = this.sceneApi.shaders.getShaderAttributes();

        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexVBO);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, skinObject.indexVBO);
        //gl.vertexAttrib4f(shaderAttributes.aColor, 0.5, 0.5, 0.5, 0.5);

        /*
         {name: "pos",           type : "vector3f"},           0+12 = 12
         {name: "bonesWeight",   type : "uint8Array", len: 4}, 12+4 = 16
         {name: "bones",         type : "uint8Array", len: 4}, 16+4 = 20
         {name: "normal",        type : "vector3f"},           20+12 = 32
         {name: "textureX",      type : "float32"},            32+4 = 36
         {name: "textureY",      type : "float32"},            36+4 = 40
         {name : "textureX2",    type : "float32"},            40+4 = 44
         {name : "textureY2",    type : "float32"}             44+4 = 48
         */

        gl.vertexAttribPointer(shaderAttributes.aPosition, 3, gl.FLOAT, false, 48, 0);  // position
        gl.vertexAttribPointer(shaderAttributes.boneWeights, 4, gl.UNSIGNED_BYTE, true, 48, 12);  // bonesWeight
        gl.vertexAttribPointer(shaderAttributes.bones, 4, gl.UNSIGNED_BYTE, false, 48, 16);  // bones
        if (shaderAttributes.aNormal) {
            gl.vertexAttribPointer(shaderAttributes.aNormal, 3, gl.FLOAT, false, 48, 20); // normal
        }
        gl.vertexAttribPointer(shaderAttributes.aTexCoord, 2, gl.FLOAT, false, 48, 32); // texcoord
        gl.vertexAttribPointer(shaderAttributes.aTexCoord2, 2, gl.FLOAT, false, 48, 40); // texcoord
    }


    setupUniforms(placementMatrix, boneMatrix) {
        var gl = this.gl;
        var uniforms = this.sceneApi.shaders.getShaderUniforms();
        if (placementMatrix) {
            gl.uniformMatrix4fv(uniforms.uPlacementMat, false, placementMatrix);
        }

        if (boneMatrix) {
            gl.uniformMatrix4fv(uniforms.uBoneMatrixes, false, boneMatrix);
        }
    }

    bindVao() {
        var vaoExt = this.sceneApi.extensions.getVaoExt();
        if (this.vao && vaoExt) {
            vaoExt.bindVertexArrayOES(this.vao);
            return true
        }
        return false
    }
    unbindVao() {
        var vaoExt = this.sceneApi.extensions.getVaoExt();
        if (this.vao && vaoExt) {
            vaoExt.bindVertexArrayOES(null);
        }
    }

    draw(skinObject, submeshArray, placementMatrix, colorVector, subMeshColors, transperencies) {
        var gl = this.gl;
        var m2Object = this.m2File;
        var uniforms = this.sceneApi.shaders.getShaderUniforms();
        var shaderAttributes = this.sceneApi.shaders.getShaderAttributes();
        var vaoExt = this.sceneApi.extensions.getVaoExt();

        this.setupUniforms(placementMatrix);

        //gl.uniform4f(uniforms.uGlobalLighting, colorVector[0], colorVector[1],colorVector[2],colorVector[3]);

        if (!this.vao || !vaoExt) {
            this.setupAttributes(skinObject);
        } else {
            vaoExt.bindVertexArrayOES(vao);
        }

        if (submeshArray) {
            for (var i = 0; i < submeshArray.length; i++) {
                this.drawMesh(i, submeshArray[i], skinObject, subMeshColors, transperencies)
            }
        }
        gl.uniform1f(uniforms.uAlphaTest, -1);
    }

    drawMesh(meshIndex, materialData, skinObject, subMeshColors, colorVector, transperencies, textureMatrix1, textureMatrix2, instanceCount) {
        var gl = this.gl;
        var m2File = this.m2File;
        var instExt = this.sceneApi.extensions.getInstancingExt();
        var blackPixelText = this.sceneApi.getBlackPixelTexture();
        var skinData = skinObject.skinFile.header;

        var uniforms = this.sceneApi.shaders.getShaderUniforms();
        var shaderAttributes = this.sceneApi.shaders.getShaderAttributes();

        gl.uniformMatrix4fv(uniforms.uTextMat1, false, textureMatrix1);
        gl.uniformMatrix4fv(uniforms.uTextMat2, false, textureMatrix2);

        if (materialData.isRendered) {
            if (materialData.texUnit1Texture) {
                //try {
                var colorIndex = skinData.texs[materialData.texUnit1TexIndex].colorIndex;
                var submeshColor = [colorVector[0], colorVector[1], colorVector[2], colorVector[3]];
                if ((colorIndex >= 0) && (subMeshColors)) {
                    var color = subMeshColors[colorIndex];
                    submeshColor = [
                        submeshColor[0] * color[0],
                        submeshColor[1] * color[1],
                        submeshColor[2] * color[2],
                        submeshColor[3] * color[3]
                    ];
                }
                var transperency = 1.0;
                var transpIndex = skinData.texs[materialData.texUnit1TexIndex].transpIndex;
                if ((transpIndex >= 0) && (transperencies)) {
                    transperency = transperencies[transpIndex];
                }
                //submeshColor[0] = submeshColor[0] * transperency;
                //submeshColor[1] = submeshColor[1] * transperency;
                //submeshColor[2] = submeshColor[2] * transperency;
                submeshColor[3] = submeshColor[3] * transperency;

                if (submeshColor[3] == 0) {
                    return;
                }

                gl.vertexAttrib4f(shaderAttributes.aColor,
                    submeshColor[0],
                    submeshColor[1],
                    submeshColor[2],
                    submeshColor[3]);

                gl.depthMask(true);

                var renderFlagIndex = skinData.texs[materialData.texUnit1TexIndex].renderFlagIndex;
                var renderFlag = m2File.renderFlags[renderFlagIndex];
                switch (renderFlag.blend) {
                    case 0 : //BM_OPAQUE
                        gl.disable(gl.BLEND);
                        gl.uniform1f(uniforms.uAlphaTest, -1.0);
                        break;
                    case 1 : //BM_TRANSPARENT
                        gl.disable(gl.BLEND);
                        //gl.uniform1f(uniforms.uAlphaTest, 2.9);
                        gl.uniform1f(uniforms.uAlphaTest, 0.903921569);
                        break;
                    case 2 : //BM_ALPHA_BLEND
                        gl.uniform1f(uniforms.uAlphaTest, -1);
                        gl.enable(gl.BLEND);
                        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); // default blend func
                        break;
                    case 3 : //BM_ADDITIVE
                        gl.uniform1f(uniforms.uAlphaTest, -1);
                        gl.enable(gl.BLEND);
                        gl.blendFunc(gl.SRC_COLOR, gl.ONE);
                        break;
                    case 4 : //BM_ADDITIVE_ALPHA
                        gl.uniform1f(uniforms.uAlphaTest, 0.00392157);
                        gl.enable(gl.BLEND);
                        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
                        break;

                    case 6:
                        gl.uniform1f(uniforms.uAlphaTest, 0.903921569);
                        gl.enable(gl.BLEND);
                        gl.blendFunc(gl.DST_COLOR, gl.SRC_COLOR);
                        break;
                    default :
                        gl.uniform1f(uniforms.uAlphaTest, -1);
                        gl.enable(gl.BLEND);
                        gl.blendFunc(gl.DST_COLOR, gl.SRC_COLOR);

                        break;
                }
                //}catch (e) {
                //    debugger;
                //}

                if ((renderFlag.flags & 0x8) > 0) {
                    //gl.uniform1i(uniforms.isBillboard, 1);
                }

                if ((renderFlag.flags & 0x4) > 0) {
                    gl.disable(gl.CULL_FACE);
                } else {
                    gl.enable(gl.CULL_FACE);
                }

                if ((renderFlag.flags & 0x10) > 0) {
                    gl.depthMask(false);
                } else {
                    gl.depthMask(true);
                }

                if (materialData.isEnviromentMapping) {
                    gl.uniform1i(uniforms.isEnviroment, 1);
                } else {
                    gl.uniform1i(uniforms.isEnviroment, 0);
                }

                /* Set up texture animation */
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, materialData.texUnit1Texture.texture);
                if (materialData.xWrapTex1) {
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
                } else {
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                }
                if (materialData.yWrapTex1) {
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
                } else {
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                }
                if (materialData.texUnit2Texture != null) {
                    gl.activeTexture(gl.TEXTURE1);
                    gl.bindTexture(gl.TEXTURE_2D, materialData.texUnit2Texture.texture);

                    if (materialData.xWrapTex2) {
                        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
                    } else {
                        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                    }
                    if (materialData.yWrapTex2) {
                        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
                    } else {
                        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                    }
                } else {
                    gl.activeTexture(gl.TEXTURE1);
                    gl.bindTexture(gl.TEXTURE_2D, blackPixelText);
                }

                meshIndex = materialData.meshIndex;
                if (instanceCount == undefined) {
                    //var error = gl.getError(); // Drop error flag
                    gl.drawElements(gl.TRIANGLES, skinData.subMeshes[meshIndex].nTriangles, gl.UNSIGNED_SHORT, skinData.subMeshes[meshIndex].StartTriangle * 2);
                } else {
                    instExt.drawElementsInstancedANGLE(gl.TRIANGLES, skinData.subMeshes[meshIndex].nTriangles, gl.UNSIGNED_SHORT, skinData.subMeshes[meshIndex].StartTriangle * 2, instanceCount);
                }
                if (materialData.texUnit2Texture != null) {
                    gl.activeTexture(gl.TEXTURE1);
                    gl.bindTexture(gl.TEXTURE_2D, null);
                    gl.activeTexture(gl.TEXTURE0);
                }

                /*
                 if ((renderFlag.flags & 0x8) > 0) {
                 gl.uniform1i(uniforms.isBillboard, 0);
                 }
                 */

                gl.depthMask(true);
                gl.disable(gl.BLEND);

            }
        }
    }
}

class M2GeomCache {
    constructor(sceneApi) {
        var self = this;

        var cache = cacheTemplate(function loadGroupWmo(fileName) {
            /* Must return promise */
            return mdxLoader(fileName);
        }, function process(m2File) {

            var m2GeomObj = new M2Geom(sceneApi);
            m2GeomObj.assign(m2File);
            m2GeomObj.createVBO();
            m2GeomObj.loadTextures();

            return m2GeomObj;
        });


        self.loadM2 = function (fileName) {
            return cache.get(fileName);
        };

        self.unLoadM2 = function (fileName) {
            cache.remove(fileName)
        }
    }
}

export default M2GeomCache;
