import Stats from 'stats.js';
import axios from 'axios';

import drawDepthShader from 'drawDepthShader.glsl';
import renderFrameBufferShader from 'renderFrameBufferShader.glsl';
import readDepthBuffer from 'readDepthBuffer.glsl';
import wmoShader from 'WmoShader.glsl';
import m2Shader from 'm2Shader.glsl';
import drawBBShader from 'drawBBShader.glsl';
import adtShader from 'adtShader.glsl';
import drawPortalShader from 'drawPortalShader.glsl';

import GraphManager from './graph/sceneGraphManager.js'


import AdtGeomCache    from './geometry/adtGeomCache.js';
import M2GeomCache     from './geometry/m2GeomCache.js';
import SkinGeomCache   from './geometry/skinGeomCache.js';
import WmoGeomCache    from './geometry/wmoGeomCache.js';
import WmoMainCache    from './geometry/wmoMainCache.js';
import TextureWoWCache from './texture/textureCache.js';

import firstPersonCamera from './camera/firstPersonCamera.js'

import {mat4, vec4, glMatrix} from 'gl-matrix'

glMatrix.setMatrixArrayType(Array);


class Scene {
    constructor(canvas) {
        var stats = new Stats();
        stats.setMode(1); // 0: fps, 1: ms, 2: mb

        // align top-left
        stats.domElement.style.position = 'absolute';
        stats.domElement.style.left = '0px';
        stats.domElement.style.top = '0px';

        document.body.appendChild(stats.domElement);
        this.stats = stats;

        var self = this;
        self.enableDeferred = false;

        self.sceneObjectList = [];
        self.sceneAdts = [];



        self.initGlContext(canvas);
        self.initArrayInstancedExt();
        self.initDepthTextureExt();
        if (self.enableDeferred) {
            self.initDeferredRendering();
        }
        self.initRenderBuffers();
        self.initAnisotropicExt();
        self.initCompressedTextureS3tcExt();

        self.initShaders()
        self.isShadersLoaded = true;

        self.initSceneApi();
        self.initSceneGraph();
        self.createBlackPixelTexture();

        self.initBoxVBO();
        self.initCaches();
        self.initCamera(canvas, document);

    }

    compileShader (vertShaderString, fragmentShaderString) {
        var gl = this.gl;

        if (this.enableDeferred) {
            vertShaderString = "#define ENABLE_DEFERRED 1\r\n"+vertShaderString;
            fragmentShaderString = "#define ENABLE_DEFERRED 1\r\n"+fragmentShaderString;
        }

        /* 1.1 Compile vertex shader */
        var vertexShader = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vertexShader, "#define COMPILING_VS 1\r\n "+vertShaderString);
        gl.compileShader(vertexShader);

        // Check if it compiled
        var success = gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS);
        if (!success) {
            // Something went wrong during compilation; get the error
            throw "could not compile shader:" + gl.getShaderInfoLog(vertexShader);
        }

        /* 1.2 Compile fragment shader */
        var fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fragmentShader, "#define COMPILING_FS 1\r\n "+fragmentShaderString);
        gl.compileShader(fragmentShader);

        // Check if it compiled
        var success = gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS);
        if (!success) {
            // Something went wrong during compilation; get the error
            throw "could not compile shader:" + gl.getShaderInfoLog(fragmentShader);
        }

        /* 1.3 Link the program */
        var program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);

        // link the program.
        gl.linkProgram(program);

        // Check if it linked.
        var success = gl.getProgramParameter(program, gl.LINK_STATUS);
        if (!success) {
            // something went wrong with the link

            throw ("program filed to link:" + gl.getProgramInfoLog (program));
        }

        var shader = {};
        shader['program'] = program;

        //From https://github.com/greggman/webgl-fundamentals/blob/master/webgl/resources/webgl-utils.js

        //Get attributes
        var shaderAttribs = {};
        var attribNum = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
        for (var ii = 0; ii < attribNum; ++ii) {
            var attribInfo = gl.getActiveAttrib(program, ii);
            if (!attribInfo) {
                break;
            }
            var index = gl.getAttribLocation(program, attribInfo.name);
            shaderAttribs[attribInfo.name] = index;
        }
        shader.shaderAttributes = shaderAttribs;


        //Get uniforms
        var shaderUniforms = {};
        var uniformsNumber = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
        for (var ii = 0; ii < uniformsNumber; ++ii) {
            var uniformInfo = gl.getActiveUniform(program, ii);
            if (!uniformInfo) {
                break;
            }

            var name = uniformInfo.name;
            if (name.substr(-3) === "[0]") {
                name = name.substr(0, name.length - 3);
            }

            var uniformLoc = gl.getUniformLocation(program, name);
            shaderUniforms[name] = uniformLoc;
        }
        shader.shaderUniforms = shaderUniforms;

        return shader;
    }
    createBlackPixelTexture() {
        var gl = this.gl;
        var blackPixelTexture = gl.createTexture();

        gl.bindTexture(gl.TEXTURE_2D, blackPixelTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255,255,255,255]));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

        gl.generateMipmap(gl.TEXTURE_2D);

        gl.bindTexture(gl.TEXTURE_2D, null);

        this.blackPixelTexture = blackPixelTexture;
    }
    initGlContext (canvas){
        function throwOnGLError(err, funcName, args) {
            throw WebGLDebugUtils.glEnumToString(err) + " was caused by call to: " + funcName;
        }
        function validateNoneOfTheArgsAreUndefined(functionName, args) {
            for (var ii = 0; ii < args.length; ++ii) {
                if (args[ii] === undefined) {
                    console.error("undefined passed to gl." + functionName + "(" +
                        WebGLDebugUtils.glFunctionArgsToString(functionName, args) + ")");
                }
            }
        }

        try {
            var gl = canvas.getContext("webgl", {premultipliedAlpha: false, alpha: false }) || canvas.getContext("experimental-webgl", {premultipliedAlpha: false});
            gl = WebGLDebugUtils.makeDebugContext(gl, throwOnGLError, validateNoneOfTheArgsAreUndefined);
        }
        catch(e) {}

        if (!gl) {
            alert("Unable to initialize WebGL. Your browser may not support it.");
            gl = null;
        }

        this.gl = gl;
        this.canvas = canvas;
    }
    initArrayInstancedExt(){
        var gl = this.gl;
        var instancing_ext = gl.getExtension('ANGLE_instanced_arrays');
        if (instancing_ext) {
            this.instancing_ext = instancing_ext;
        }
    }
    initAnisotropicExt (){
        var gl = this.gl;
        var anisotropic_ext = gl.getExtension('EXT_texture_filter_anisotropic');
        if (anisotropic_ext) {
            this.anisotropic_ext = anisotropic_ext;
        }
    }
    initCompressedTextureS3tcExt () {
        var gl = this.gl;
        var ext = (
            gl.getExtension("WEBGL_compressed_texture_s3tc") ||
            gl.getExtension("MOZ_WEBGL_compressed_texture_s3tc") ||
            gl.getExtension("WEBKIT_WEBGL_compressed_texture_s3tc")
        );
        if (ext) {
            this.comp_tex_ext = ext;
        }
    }
    initDepthTextureExt () {
        var gl = this.gl;

        var depth_texture_ext = gl.getExtension('WEBGL_depth_texture');
        if (depth_texture_ext) {
            this.depth_texture_ext = depth_texture_ext;
        }
    }
    initDeferredRendering (){
        var gl = this.gl;

        var wdb_ext = gl.getExtension('WEBGL_draw_buffers');
        if (wdb_ext) {
            this.wdb_ext = wdb_ext;
        } else {
            this.enableDeferred = false;
        }
    }
    initShaders (){
        var self = this;

        /* Get and compile shaders */
        self.renderFrameShader = self.compileShader(renderFrameBufferShader, renderFrameBufferShader);

        self.drawDepthBuffer = self.compileShader(drawDepthShader, drawDepthShader);

        self.readDepthBuffer = self.compileShader(readDepthBuffer, readDepthBuffer);

        self.wmoShader = self.compileShader(wmoShader, wmoShader);
        self.wmoInstancingShader = self.compileShader("#define INSTANCED 1\r\n " + wmoShader, "#define INSTANCED 1\r\n " + wmoShader);

        self.m2Shader = self.compileShader(m2Shader, m2Shader);
        self.m2InstancingShader = self.compileShader("#define INSTANCED 1\r\n " + m2Shader, "#define INSTANCED 1\r\n " + m2Shader);

        self.bbShader = self.compileShader(drawBBShader, drawBBShader);

        self.adtShader = self.compileShader(adtShader, adtShader);

        self.drawPortalShader = self.compileShader(drawPortalShader, drawPortalShader);
    }
    initCaches (){
        this.wmoGeomCache = new WmoGeomCache(this.sceneApi);
        this.wmoMainCache = new WmoMainCache(this.sceneApi);
        this.textureCache = new TextureWoWCache(this.sceneApi);
        this.m2GeomCache = new M2GeomCache(this.sceneApi);
        this.skinGeomCache = new SkinGeomCache(this.sceneApi);
        this.adtGeomCache = new AdtGeomCache(this.sceneApi);
    }
    initDrawBuffers (frameBuffer) {
        var gl = this.gl;
        var wdb_ext = this.wdb_ext;
        // Taken from https://hacks.mozilla.org/2014/01/webgl-deferred-shading/
        // And https://github.com/YuqinShao/Tile_Based_WebGL_DeferredShader/blob/master/deferredshading/deferred.js

        this.texture_floatExt = gl.getExtension("OES_texture_float");
        this.texture_floatLinExt = gl.getExtension("OES_texture_float_linear");

        var normalTexture = gl.createTexture();
        var positionTexture = gl.createTexture();
        var colorTexture = gl.createTexture();
        var depthRGBTexture = gl.createTexture();

        gl.bindTexture(gl.TEXTURE_2D, normalTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.canvas.width, this.canvas.height, 0, gl.RGBA, gl.FLOAT, null);


        gl.bindTexture(gl.TEXTURE_2D, positionTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.canvas.width, this.canvas.height, 0, gl.RGBA, gl.FLOAT, null);


        gl.bindTexture(gl.TEXTURE_2D, colorTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.canvas.width, this.canvas.height, 0, gl.RGBA, gl.FLOAT, null);


        gl.bindTexture(gl.TEXTURE_2D, depthRGBTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.canvas.width, this.canvas.height, 0, gl.RGBA, gl.FLOAT, null);


        gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuffer);
        var bufs = [];
        bufs[0] = wdb_ext.COLOR_ATTACHMENT0_WEBGL;
        bufs[1] = wdb_ext.COLOR_ATTACHMENT1_WEBGL;
        bufs[2] = wdb_ext.COLOR_ATTACHMENT2_WEBGL;
        bufs[3] = wdb_ext.COLOR_ATTACHMENT3_WEBGL;
        wdb_ext.drawBuffersWEBGL(bufs);

        gl.framebufferTexture2D(gl.FRAMEBUFFER, bufs[0], gl.TEXTURE_2D, depthRGBTexture, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, bufs[1], gl.TEXTURE_2D, normalTexture, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, bufs[2], gl.TEXTURE_2D, positionTexture, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, bufs[3], gl.TEXTURE_2D, colorTexture, 0);

        this.depthRGBTexture = depthRGBTexture;
        this.normalTexture = normalTexture;
        this.positionTexture = positionTexture;
        this.colorTexture = colorTexture;
    }
    initRenderBuffers () {
        var gl = this.gl;
        if(!this.depth_texture_ext) { return; }

        // Create a color texture
        var colorTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, colorTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.canvas.width, this.canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

        // Create the depth texture
        var depthTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, depthTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT, this.canvas.width, this.canvas.height, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);

        var framebuffer = gl.createFramebuffer();
        if (this.enableDeferred) {
            this.initDrawBuffers(framebuffer)
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);

        if (!this.enableDeferred) {
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTexture, 0);
        }
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTexture, 0);

        this.frameBuffer = framebuffer;
        this.frameBufferColorTexture = colorTexture;
        this.frameBufferDepthTexture = depthTexture;

        var verts = [
            1,  1,
            -1,  1,
            -1, -1,
            1,  1,
            -1, -1,
            1, -1,
        ];
        var vertBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vertBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);

        this.vertBuffer = vertBuffer;
    }
    initSceneGraph () {
        this.graphManager = new GraphManager(this.sceneApi);
    }
    initSceneApi () {
        var self = this;
        this.sceneApi = {
            getGlContext: function () {
                return self.gl;
            },
            getCurrentWdt : function (){
                return self.currentWdt;
            },
            getBlackPixelTexture : function () {
                return self.blackPixelTexture;
            },
            extensions : {
                getInstancingExt : function (){
                    return self.instancing_ext;
                },
                getAnisotropicExt : function () {
                    return self.anisotropic_ext;
                },
                getComprTextExt : function () {
                    return self.comp_tex_ext;
                }
            },
            shaders : {
                activateBoundingBoxShader : function () {
                    self.activateBoundingBoxShader();
                },
                deativateBoundingBoxShader : function() {
                    self.deactivateBoundingBoxShader();
                },
                activateAdtShader : function () {
                    self.activateAdtShader();
                },
                activateDrawPortalShader : function () {
                    self.activateDrawPortalShader();
                },

                activateWMOShader : function () {
                    self.activateWMOShader()
                },
                deactivateWMOShader : function () {
                    self.deactivateWMOShader()
                },
                activateM2Shader : function () {
                    self.activateM2Shader()
                },
                deactivateM2Shader : function () {
                    self.deactivateM2Shader();
                },
                activateM2InstancingShader : function (){
                    self.activateM2InstancingShader();
                },
                deactivateM2InstancingShader : function (){
                    self.deactivateM2InstancingShader();
                },
                getShaderUniforms: function () {
                    return self.currentShaderProgram.shaderUniforms;
                },
                getShaderAttributes: function () {
                    return self.currentShaderProgram.shaderAttributes;
                }

            },

            objects : {
                loadAdtM2Obj : function (doodad){
                    return self.graphManager.addAdtM2Object(doodad);
                },
                loadAdtWmo : function (wmoDef){
                    return self.graphManager.addWmoObject(wmoDef);
                },
                loadWmoM2Obj : function (doodadDef, placementMatrix, useLocalLightning){
                    return self.graphManager.addWmoM2Object(doodadDef, placementMatrix, useLocalLightning);
                },
                loadAdtChunk: function(fileName) {
                    return self.graphManager.addADTObject(fileName)
                }
            },
            resources : {
                loadTexture: function (fileName) {
                    return self.textureCache.loadTexture(fileName);
                },
                unLoadTexture: function (fileName) {
                    self.textureCache.unLoadTexture(fileName);
                },
                loadWmoMain: function (fileName) {
                    return self.wmoMainCache.loadWmoMain(fileName);
                },
                unloadWmoMain: function (fileName) {
                    self.wmoMainCache.unloadWmoMain(fileName);
                },
                loadWmoGeom: function (fileName) {
                    return self.wmoGeomCache.loadWmoGeom(fileName);
                },
                unloadWmoGeom: function (fileName) {
                    self.wmoGeomCache.unLoadWmoGeom(fileName);
                },
                loadM2Geom: function (fileName) {
                    return self.m2GeomCache.loadM2(fileName);
                },
                unloadM2Geom: function (fileName) {
                    self.m2GeomCache.unLoadM2(fileName);
                },
                loadSkinGeom: function (fileName) {
                    return self.skinGeomCache.loadSkin(fileName);
                },
                unloadSkinGeom: function (fileName) {
                    self.skinGeomCache.unLoadSkin(fileName);
                },
                loadAdtGeom: function (fileName) {
                    return self.adtGeomCache.loadAdt(fileName);
                },
                unloadAdtGeom: function (fileName) {
                    self.adtGeomCache.unLoadAdt(fileName);
                }
            }
        };
    }
    initCamera (canvas, document){
        this.camera = firstPersonCamera(canvas, document);
    }
    initBoxVBO (){
        var gl = this.gl;

        //From https://en.wikibooks.org/wiki/OpenGL_Programming/Bounding_box
        var vertices = [
            -1, -1, -1, //0
            1, -1, -1,  //1
            1, -1, 1,   //2
            -1, -1, 1,  //3
            -1, 1, 1,   //4
            1, 1, 1,    //5
            1, 1, -1,   //6
            -1, 1, -1,  //7
        ];

        var vbo_vertices = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo_vertices);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);

        var elements = [
            0, 1, 1, 2, 2, 3, 3, 0,
            4, 5, 5, 6, 6, 7, 7, 4,
            7, 6, 6, 1, 1, 0, 0, 7,
            3, 2, 2, 5, 5, 4, 4, 3,
            6, 5, 5, 2, 2, 1, 1, 6,
            0, 3, 3, 4, 4, 7, 7, 0
        ];
        var ibo_elements = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo_elements);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Int16Array(elements), gl.STATIC_DRAW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
        this.bbBoxVars = {
            vbo_vertices : vbo_vertices,
            ibo_elements : ibo_elements
        }
    }

    glClearScreen (gl){
        gl.clearDepth(1.0);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LESS);

        gl.disable(gl.BLEND);
        gl.clearColor(0.6, 0.95, 1.0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.disable(gl.CULL_FACE);
    }
    activateRenderFrameShader () {
        this.currentShaderProgram = this.renderFrameShader;
        if (this.currentShaderProgram) {
            var gl = this.gl;
            gl.useProgram(this.currentShaderProgram.program);
            var shaderAttributes = this.sceneApi.shaders.getShaderAttributes();

            gl.activeTexture(gl.TEXTURE0);

            gl.disableVertexAttribArray(1);


            gl.uniform1i(this.currentShaderProgram.shaderUniforms.u_sampler, 0);
            if (this.currentShaderProgram.shaderUniforms.u_depth) {
                gl.uniform1i(this.currentShaderProgram.shaderUniforms.u_depth, 1);
            }
        }
    }
    activateRenderDepthShader () {
        this.currentShaderProgram = this.drawDepthBuffer;
        if (this.currentShaderProgram) {
            var gl = this.gl;
            gl.useProgram(this.currentShaderProgram.program);
            var shaderAttributes = this.sceneApi.shaders.getShaderAttributes();

            gl.activeTexture(gl.TEXTURE0);
        }
    }
    activateReadDepthBuffer () {
        this.currentShaderProgram = this.readDepthBuffer;
        if (this.currentShaderProgram) {
            var gl = this.gl;
            gl.useProgram(this.currentShaderProgram.program);
            var shaderAttributes = this.sceneApi.shaders.getShaderAttributes();

            gl.activeTexture(gl.TEXTURE0);

            gl.enableVertexAttribArray(this.currentShaderProgram.shaderAttributes.position);
            gl.enableVertexAttribArray(this.currentShaderProgram.shaderAttributes.texture);

        }
    }
    activateAdtShader (){
        this.currentShaderProgram = this.adtShader;
        if (this.currentShaderProgram) {
            var gl = this.gl;
            var instExt = this.sceneApi.extensions.getInstancingExt();
            var shaderAttributes = this.sceneApi.shaders.getShaderAttributes();

            gl.useProgram(this.currentShaderProgram.program);

            gl.enableVertexAttribArray(shaderAttributes.aHeight);
            gl.enableVertexAttribArray(shaderAttributes.aIndex);

            gl.uniformMatrix4fv(this.currentShaderProgram.shaderUniforms.uLookAtMat, false, this.lookAtMat4);
            gl.uniformMatrix4fv(this.currentShaderProgram.shaderUniforms.uPMatrix, false, this.perspectiveMatrix);

            if (this.currentWdt && ((this.currentWdt.flags & 0x04) > 0)) {
                gl.uniform1i(this.currentShaderProgram.shaderUniforms.uNewFormula, 1);
            } else {
                gl.uniform1i(this.currentShaderProgram.shaderUniforms.uNewFormula, 0);
            }

            gl.uniform1i(this.currentShaderProgram.shaderUniforms.uLayer0, 0);
            gl.uniform1i(this.currentShaderProgram.shaderUniforms.uAlphaTexture, 1);
            gl.uniform1i(this.currentShaderProgram.shaderUniforms.uLayer1, 2);
            gl.uniform1i(this.currentShaderProgram.shaderUniforms.uLayer2, 3);
            gl.uniform1i(this.currentShaderProgram.shaderUniforms.uLayer3, 4);
        }
    }
    activateWMOShader () {
        this.currentShaderProgram = this.wmoShader;
        if (this.currentShaderProgram) {
            var gl = this.gl;
            gl.useProgram(this.currentShaderProgram.program);
            var shaderAttributes = this.sceneApi.shaders.getShaderAttributes();

            gl.enableVertexAttribArray(shaderAttributes.aPosition);
            if (shaderAttributes.aNormal) {
                gl.enableVertexAttribArray(shaderAttributes.aNormal);
            }
            gl.enableVertexAttribArray(shaderAttributes.aTexCoord);
            gl.enableVertexAttribArray(shaderAttributes.aTexCoord2);
            gl.enableVertexAttribArray(shaderAttributes.aColor);
            gl.enableVertexAttribArray(shaderAttributes.aColor2);

            gl.uniformMatrix4fv(this.currentShaderProgram.shaderUniforms.uLookAtMat, false, this.lookAtMat4);
            gl.uniformMatrix4fv(this.currentShaderProgram.shaderUniforms.uPMatrix, false, this.perspectiveMatrix);

            gl.uniform1i(this.currentShaderProgram.shaderUniforms.uTexture, 0);
            gl.uniform1i(this.currentShaderProgram.shaderUniforms.uTexture2, 1);

            gl.activeTexture(gl.TEXTURE0);
        }
    }
    deactivateWMOShader () {
        var gl = this.gl;
        var instExt = this.sceneApi.extensions.getInstancingExt();
        var shaderAttributes = this.sceneApi.shaders.getShaderAttributes();

        //gl.disableVertexAttribArray(shaderAttributes.aPosition);
        if (shaderAttributes.aNormal) {
            gl.disableVertexAttribArray(shaderAttributes.aNormal);
        }

        gl.disableVertexAttribArray(shaderAttributes.aTexCoord);
        gl.disableVertexAttribArray(shaderAttributes.aTexCoord2);

        gl.disableVertexAttribArray(shaderAttributes.aColor);
        gl.disableVertexAttribArray(shaderAttributes.aColor2);
    }
    activateM2Shader () {
        this.currentShaderProgram = this.m2Shader;
        if (this.currentShaderProgram) {
            var gl = this.gl;
            gl.useProgram(this.currentShaderProgram.program);
            var shaderAttributes = this.sceneApi.shaders.getShaderAttributes();

            gl.enableVertexAttribArray(shaderAttributes.aPosition);
            if (shaderAttributes.aNormal) {
                gl.enableVertexAttribArray(shaderAttributes.aNormal);
            }
            gl.enableVertexAttribArray(shaderAttributes.boneWeights);
            gl.enableVertexAttribArray(shaderAttributes.bones);
            gl.enableVertexAttribArray(shaderAttributes.aTexCoord);
            gl.enableVertexAttribArray(shaderAttributes.aTexCoord2);
            gl.disableVertexAttribArray(shaderAttributes.aColor);

            gl.uniformMatrix4fv(this.currentShaderProgram.shaderUniforms.uLookAtMat, false, this.lookAtMat4);
            gl.uniformMatrix4fv(this.currentShaderProgram.shaderUniforms.uPMatrix, false, this.perspectiveMatrix);
            if (this.currentShaderProgram.shaderUniforms.isBillboard) {
                gl.uniform1i(this.currentShaderProgram.shaderUniforms.isBillboard, 0);
            }

            gl.uniform1i(this.currentShaderProgram.shaderUniforms.uTexture, 0);
            gl.uniform1i(this.currentShaderProgram.shaderUniforms.uTexture2, 1);


            gl.activeTexture(gl.TEXTURE0);
        }
    }
    deactivateM2Shader () {
        var gl = this.gl;
        var instExt = this.sceneApi.extensions.getInstancingExt();
        var shaderAttributes = this.sceneApi.shaders.getShaderAttributes();

        //gl.disableVertexAttribArray(shaderAttributes.aPosition);
        if (shaderAttributes.aNormal) {
            gl.disableVertexAttribArray(shaderAttributes.aNormal);
        }
        gl.disableVertexAttribArray(shaderAttributes.boneWeights);
        gl.disableVertexAttribArray(shaderAttributes.bones);

        gl.disableVertexAttribArray(shaderAttributes.aTexCoord);
        gl.disableVertexAttribArray(shaderAttributes.aTexCoord2);
    }
    activateM2InstancingShader () {
        this.currentShaderProgram = this.m2InstancingShader;
        if (this.currentShaderProgram) {
            var gl = this.gl;
            var instExt = this.sceneApi.extensions.getInstancingExt();
            var shaderAttributes = this.sceneApi.shaders.getShaderAttributes();

            gl.useProgram(this.currentShaderProgram.program);

            gl.uniformMatrix4fv(this.currentShaderProgram.shaderUniforms.uLookAtMat, false, this.lookAtMat4);
            gl.uniformMatrix4fv(this.currentShaderProgram.shaderUniforms.uPMatrix, false, this.perspectiveMatrix);

            gl.activeTexture(gl.TEXTURE0);

            gl.enableVertexAttribArray(shaderAttributes.aPosition);
            if (shaderAttributes.aNormal) {
                gl.enableVertexAttribArray(shaderAttributes.aNormal);
            }
            gl.enableVertexAttribArray(shaderAttributes.boneWeights);
            gl.enableVertexAttribArray(shaderAttributes.bones);
            gl.enableVertexAttribArray(shaderAttributes.aTexCoord);
            gl.enableVertexAttribArray(shaderAttributes.aTexCoord2);
            gl.disableVertexAttribArray(shaderAttributes.aColor);

            gl.enableVertexAttribArray(shaderAttributes.uPlacementMat + 0);
            gl.enableVertexAttribArray(shaderAttributes.uPlacementMat + 1);
            gl.enableVertexAttribArray(shaderAttributes.uPlacementMat + 2);
            gl.enableVertexAttribArray(shaderAttributes.uPlacementMat + 3);
            if (instExt != null) {
                instExt.vertexAttribDivisorANGLE(shaderAttributes.uPlacementMat + 0, 1);
                instExt.vertexAttribDivisorANGLE(shaderAttributes.uPlacementMat + 1, 1);
                instExt.vertexAttribDivisorANGLE(shaderAttributes.uPlacementMat + 2, 1);
                instExt.vertexAttribDivisorANGLE(shaderAttributes.uPlacementMat + 3, 1);
            }
        }

    }
    deactivateM2InstancingShader () {
        var gl = this.gl;
        var instExt = this.sceneApi.extensions.getInstancingExt();
        var shaderAttributes = this.sceneApi.shaders.getShaderAttributes();

        //gl.disableVertexAttribArray(shaderAttributes.aPosition);
        if (shaderAttributes.aNormal) {
            gl.disableVertexAttribArray(shaderAttributes.aNormal);
        }
        gl.disableVertexAttribArray(shaderAttributes.boneWeights);
        gl.disableVertexAttribArray(shaderAttributes.bones);
        gl.disableVertexAttribArray(shaderAttributes.aTexCoord);
        gl.disableVertexAttribArray(shaderAttributes.aTexCoord2);

        if (instExt) {
            instExt.vertexAttribDivisorANGLE(shaderAttributes.uPlacementMat + 0, 0);
            instExt.vertexAttribDivisorANGLE(shaderAttributes.uPlacementMat + 1, 0);
            instExt.vertexAttribDivisorANGLE(shaderAttributes.uPlacementMat + 2, 0);
            instExt.vertexAttribDivisorANGLE(shaderAttributes.uPlacementMat + 3, 0);
        }
        gl.disableVertexAttribArray(shaderAttributes.uPlacementMat + 0);
        gl.disableVertexAttribArray(shaderAttributes.uPlacementMat + 1);
        gl.disableVertexAttribArray(shaderAttributes.uPlacementMat + 2);
        gl.disableVertexAttribArray(shaderAttributes.uPlacementMat + 3);

    }
    activateBoundingBoxShader () {
        this.currentShaderProgram = this.bbShader;
        if (this.currentShaderProgram) {
            var gl = this.gl;
            gl.useProgram(this.currentShaderProgram.program);

            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.bbBoxVars.ibo_elements);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.bbBoxVars.vbo_vertices);

            //gl.enableVertexAttribArray(this.currentShaderProgram.shaderAttributes.aPosition);
            gl.vertexAttribPointer(this.currentShaderProgram.shaderAttributes.aPosition, 3, gl.FLOAT, false, 0, 0);  // position

            gl.uniformMatrix4fv(this.currentShaderProgram.shaderUniforms.uLookAtMat, false, this.lookAtMat4);
            gl.uniformMatrix4fv(this.currentShaderProgram.shaderUniforms.uPMatrix, false, this.perspectiveMatrix);
        }
    }
    activateDrawPortalShader () {
        this.currentShaderProgram = this.drawPortalShader;
        if (this.currentShaderProgram) {
            var gl = this.gl;
            gl.useProgram(this.currentShaderProgram.program);

            gl.uniformMatrix4fv(this.currentShaderProgram.shaderUniforms.uLookAtMat, false, this.lookAtMat4);
            gl.uniformMatrix4fv(this.currentShaderProgram.shaderUniforms.uPMatrix, false, this.perspectiveMatrix);
        }
    }
    drawTexturedQuad(gl, texture, x, y, width, height, canv_width, canv_height) {
        if(!this.quadShader) {
            // Set up the verticies and indices
            var quadVerts = [
                -1,  1,  0, 1,
                -1, -1,  0, 0,
                1,  1,  1, 1,

                -1, -1,  0, 0,
                1, -1,  1, 0,
                1,  1,  1, 1
            ];

            this.quadVertBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVertBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(quadVerts), gl.STATIC_DRAW);
        }
        gl.disable(gl.DEPTH_TEST);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVertBuffer);

        gl.vertexAttribPointer(this.drawDepthBuffer.shaderAttributes.position, 2, gl.FLOAT, false, 16, 0);
        gl.vertexAttribPointer(this.drawDepthBuffer.shaderAttributes.texture, 2, gl.FLOAT, false, 16, 8);

        gl.uniform1f(this.drawDepthBuffer.shaderUniforms.uWidth, width/canv_width);
        gl.uniform1f(this.drawDepthBuffer.shaderUniforms.uHeight, height/canv_height);
        gl.uniform1f(this.drawDepthBuffer.shaderUniforms.uX, x/canv_width);
        gl.uniform1f(this.drawDepthBuffer.shaderUniforms.uY, y/canv_height);

        gl.bindTexture(gl.TEXTURE_2D, texture);

        gl.drawArrays(gl.TRIANGLES, 0, 6);

        gl.enable(gl.DEPTH_TEST);
    }
    drawFrameBuffer () {
        var gl = this.gl;

        if (this.enableDeferred){
            gl.bindTexture(gl.TEXTURE_2D, this.colorTexture);
        } else {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.frameBufferColorTexture);

            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, this.frameBufferDepthTexture);
        }
        var uniforms = this.currentShaderProgram.shaderUniforms;

        if(uniforms.gauss_offsets) {
            gl.uniform1fv(uniforms.gauss_offsets, [0.0/this.canvas.height, 1.0/this.canvas.height, 2.0/this.canvas.height, 3.0/this.canvas.height, 4.0/this.canvas.height]);
            gl.uniform1fv(uniforms.gauss_weights, [0.2270270270, 0.1945945946, 0.1216216216,0.0540540541, 0.0162162162]);
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertBuffer);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    draw (deltaTime) {
        var gl = this.gl;
        if (!this.depthBuffer) {
            var depthBuffer = new Uint8Array(this.canvas.width*this.canvas.height*4);
            this.depthBuffer = depthBuffer;
        }

        this.stats.begin();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.frameBuffer);
        //gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        var cameraVecs = this.camera.tick(deltaTime);

        var lookAtMat4 = [];
        mat4.lookAt(lookAtMat4, cameraVecs.cameraVec3, cameraVecs.lookAtVec3, [0,0,1]);

        //Static camera for tests
        var staticLookAtMat = [];
        mat4.lookAt(staticLookAtMat,
            [-1873.050857362244,  5083.140737452966, 574.1095576120073 ],
            [-1872.9643854413891, 5083.406870660209, 573.1495077576213],
            [0,0,1]);

        var perspectiveMatrix = [];
        mat4.perspective(perspectiveMatrix, 45.0, this.canvas.width / this.canvas.height, 1, 1000);
        //mat4.ortho(perspectiveMatrix, -100, 100, -100, 100, -100, 100);


        this.graphManager.checkCulling(perspectiveMatrix, lookAtMat4);
        //Matrixes from previous frame
        if (this.perspectiveMatrix && this.lookAtMat4) {
            //this.graphManager.checkAgainstDepthBuffer(this.perspectiveMatrix, this.lookAtMat4, this.floatDepthBuffer, this.canvas.width, this.canvas.height);
        }

        this.perspectiveMatrix = perspectiveMatrix;
        if (cameraVecs.staticCamera) {
            this.lookAtMat4 = staticLookAtMat;
        } else {
            this.lookAtMat4 = lookAtMat4;
        }

        if (!this.isShadersLoaded) return;

        this.glClearScreen(gl);
        gl.activeTexture(gl.TEXTURE0);

        this.graphManager.setCameraPos(
            vec4.fromValues(
                cameraVecs.cameraVec3[0],
                cameraVecs.cameraVec3[1],
                cameraVecs.cameraVec3[2],
                1
            )
        );
        this.graphManager.setLookAtMat(lookAtMat4);
        var updateRes = this.graphManager.update(deltaTime);

        gl.depthMask(true);
        this.graphManager.draw();
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        this.glClearScreen(gl);

        //save depthBuffer for occlusion culling next frame
        this.activateReadDepthBuffer();
        gl.disable(gl.DEPTH_TEST);

        //Render depth buffer into array into js
        /*
        if( this.quadVertBuffer) {
            gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVertBuffer);

            gl.vertexAttribPointer(this.currentShaderProgram.shaderAttributes.position, 2, gl.FLOAT, false, 16, 0);
            gl.vertexAttribPointer(this.currentShaderProgram.shaderAttributes.texture, 2, gl.FLOAT, false, 16, 8);

            gl.drawArrays(gl.TRIANGLES, 0, 6);
            gl.readPixels(0,0,this.canvas.width, this.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, this.depthBuffer);
            //Normalize depthBuffer
            var floatDepth = new Array(this.canvas.width*this.canvas.height);
            for (var i = 0; i < this.canvas.width*this.canvas.height; i++) {
                floatDepth[i] = (this.depthBuffer[4*index + 0] * 255.0 + this.depthBuffer[4*index + 1]) / 65536.0
            }
            this.floatDepthBuffer = floatDepth;
        }
        */

        //Render framebuffer texture into screen
        this.activateRenderFrameShader();
        this.drawFrameBuffer();


        //Draw frameBuffer depth texture into screen
        this.activateRenderDepthShader();
        this.drawTexturedQuad(gl, this.frameBufferDepthTexture,
            this.canvas.width * 0.75, 0,
            this.canvas.width * 0.25, this.canvas.height * 0.25,
            this.canvas.width, this.canvas.height);
        gl.enable(gl.DEPTH_TEST);

        this.stats.end();

        return {cameraVecs : cameraVecs, updateResult : updateRes};
    }
    loadM2File (mddf) {
        this.sceneApi.objects.loadAdtM2Obj(mddf);
    }
    loadWMOFile(modf){
        this.sceneApi.objects.loadAdtWmo(modf);
    }
    loadMap (mapName, x, y){
        var self = this;
        var wdtFileName = "world/maps/"+mapName+"/"+mapName+".wdt";

        wdtLoader(wdtFileName).then(function success(wdtFile){
            self.currentWdt = wdtFile;
            if (wdtFile.isWMOMap) {

                self.sceneApi.objects.loadAdtWmo(wdtFile.modfChunk)
            } else {
                var adtFileName = "world/maps/"+mapName+"/"+mapName+"_"+x+"_"+y+".adt";
                self.graphManager.addADTObject(adtFileName);
            }

        }, function error(){
        })
    }
    setCameraPos (x, y, z) {
        this.camera.setCameraPos(x,y,z);
    }
}

export default Scene;