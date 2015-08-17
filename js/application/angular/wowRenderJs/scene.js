/**
 * Created by Deamon on 08/03/2015.
 */

'use strict';

(function (window, $, undefined) {
    var scene = angular.module('js.wow.render.scene', [
        'js.wow.render.geometry.wmoGeomCache',
        'js.wow.render.geometry.wmoMainCache',
        'js.wow.render.geometry.m2GeomCache',
        'js.wow.render.geometry.skinGeomCache',
        'js.wow.render.wmoObjectFactory',
        'js.wow.render.texture.textureCache',
        'js.wow.render.camera.firstPersonCamera']);
    scene.factory("scene", ['$q', '$timeout', '$http', 'wmoObjectFactory', 'wmoMainCache', 'wmoGeomCache', 'textureWoWCache', 'm2GeomCache', 'skinGeomCache', 'firstPersonCamera',
        function ($q, $timeout, $http, wmoObjectFactory, wmoMainCache, wmoGeomCache, textureWoWCache, m2GeomCache, skinGeomCache, firstPersonCamera) {

        function Scene (canvas) {
            var stats = new Stats();
            stats.setMode( 1 ); // 0: fps, 1: ms, 2: mb

            // align top-left
            stats.domElement.style.position = 'absolute';
            stats.domElement.style.left = '0px';
            stats.domElement.style.top = '0px';

            document.body.appendChild( stats.domElement );
            this.stats = stats;

            var self = this;

            self.sceneObjectList = [];
            self.initGlContext(canvas);
            self.initShaders().then(function success() {
                self.isShadersLoaded = true;
            }, function error(){
            });
            self.initSceneApi();
            self.initDeferredRendering();
            self.initCaches();
            self.initCamera(canvas, document);

        }
        Scene.prototype = {
            compileShader : function(vectShaderString, fragmentShaderString) {
                var gl = this.gl;

                /* 1.1 Compile vertex shader */
                var vertexShader = gl.createShader(gl.VERTEX_SHADER);
                gl.shaderSource(vertexShader, "#define COMPILING_VS 1\r\n "+vectShaderString);
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

                gl.bindAttribLocation(program, 0, "aPosition");
                gl.bindAttribLocation(program, 1, "aNormal");
                gl.bindAttribLocation(program, 2, "aTexCoord");
                gl.bindAttribLocation(program, 3, "aColor");

                // link the program.
                gl.linkProgram(program);

                // Check if it linked.
                var success = gl.getProgramParameter(program, gl.LINK_STATUS);
                if (!success) {
                    // something went wrong with the link

                    throw ("program filed to link:" + gl.getProgramInfoLog (program));
                }

                var lookAtMatrix = gl.getUniformLocation(program, "uLookAtMat");
                var placementMatrix = gl.getUniformLocation(program, "uPlacementMat");
                var projectionMatrix = gl.getUniformLocation(program, "uPMatrix");
                var uAlphaTest = gl.getUniformLocation(program, "uAlphaTest");

                return {
                    program : program,
                    lookAtMatrix : lookAtMatrix,
                    placementMatrix : placementMatrix,
                    projectionMatrix : projectionMatrix,
                    uAlphaTest : uAlphaTest
                }
            },
            initGlContext : function (canvas){
                function throwOnGLError(err, funcName, args) {
                    throw WebGLDebugUtils.glEnumToString(err) + " was caused by call to: " + funcName;
                }

                try {
                    var gl = canvas.getContext("webgl", {premultipliedAlpha: false}) || canvas.getContext("experimental-webgl", {premultipliedAlpha: false});
                    gl = WebGLDebugUtils.makeDebugContext(gl, throwOnGLError);
                }
                catch(e) {}

                if (!gl) {
                    alert("Unable to initialize WebGL. Your browser may not support it.");
                    gl = null;
                }

                this.gl = gl;
                this.canvas = canvas;
            },
            initDeferredRendering : function (){
                var gl = this.gl;

                var wdb_ext = gl.getExtension('WEBGL_draw_buffers');
                if (wdb_ext) {
                    gl.getExtension("WEBGL_depth_texture");
                    gl.getExtension("OES_texture_float");
                    gl.getExtension("OES_texture_float_linear");
                    // We can use deferred shading
                    this.deferredRendering = true;

                    // Taken from https://hacks.mozilla.org/2014/01/webgl-deferred-shading/
                    // And https://github.com/YuqinShao/Tile_Based_WebGL_DeferredShader/blob/master/deferredshading/deferred.js

                    var depthTexture = gl.createTexture();
                    var normalTexture = gl.createTexture();
                    var positionTexture = gl.createTexture();
                    var colorTexture = gl.createTexture();
                    var depthRGBTexture = gl.createTexture();

                    gl.bindTexture(gl.TEXTURE_2D, depthTexture);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT, this.canvas.width, this.canvas.height, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, null);


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

                    var fbo = gl.createFramebuffer();
                    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
                    var bufs = [];
                    bufs[0] = wdb_ext.COLOR_ATTACHMENT0_WEBGL;
                    bufs[1] = wdb_ext.COLOR_ATTACHMENT1_WEBGL;
                    bufs[2] = wdb_ext.COLOR_ATTACHMENT2_WEBGL;
                    bufs[3] = wdb_ext.COLOR_ATTACHMENT3_WEBGL;
                    wdb_ext.drawBuffersWEBGL(bufs);

                    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTexture, 0);
                    gl.framebufferTexture2D(gl.FRAMEBUFFER, bufs[0], gl.TEXTURE_2D, depthRGBTexture, 0);
                    gl.framebufferTexture2D(gl.FRAMEBUFFER, bufs[1], gl.TEXTURE_2D, normalTexture, 0);
                    gl.framebufferTexture2D(gl.FRAMEBUFFER, bufs[2], gl.TEXTURE_2D, positionTexture, 0);
                    gl.framebufferTexture2D(gl.FRAMEBUFFER, bufs[3], gl.TEXTURE_2D, colorTexture, 0);


                    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                }
            },
            initShaders : function (){
                var self = this;
                var promise = null;
                var promisesArray = [];

                /* Get and compile shaders */
                promise = $http.get("glsl/WmoShader.glsl")
                    .then(function success(result){
                        var shaderText = result.data;
                        var shader = self.compileShader(shaderText, shaderText);
                        self.wmoShader = shader;
                    },function error(){
                        throw 'could not load shader'
                    });

                promisesArray.push(promise);

                return $q.all(promisesArray)
            },
            initCaches : function (){
                this.wmoGeomCache = new wmoGeomCache(this.sceneApi);
                this.wmoMainCache = new wmoMainCache(this.sceneApi);
                this.textureCache = new textureWoWCache(this.sceneApi);
                this.m2GeomCache = new m2GeomCache(this.sceneApi);
                this.skinGeomCache = new skinGeomCache(this.sceneApi);
            },
            initSceneApi : function() {
                var self = this;
                this.sceneApi = {
                    getGlContext: function () {
                        return self.gl;
                    },
                    getShaderUniforms: function () {
                        return {
                            lookAtMatrix: self.currentShaderProgram.lookAtMatrix,
                            placementMatrix: self.currentShaderProgram.placementMatrix,
                            projectionMatrix: self.currentShaderProgram.projectionMatrix,
                            uAlphaTest: self.uAlphaTest
                        }
                    },
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
                    loadAdtGeom: function () {

                    },
                    unloadAdtGeom: function () {

                    }
                };
            },
            initCamera : function (canvas, document){
                this.camera = firstPersonCamera(canvas, document);
            },

            glClearScreen : function(gl){
                gl.clearDepth(1.0);
                gl.enable(gl.DEPTH_TEST);
                gl.depthFunc(gl.LEQUAL);

                gl.disable(gl.BLEND);
                gl.clearColor(0.6, 0.95, 1.0, 1);
                gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
                gl.disable(gl.CULL_FACE);
            },
            draw : function (deltaTime) {
                var gl = this.gl;

                var cameraVecs = this.camera.tick(deltaTime);

                var lookAtMat4 = [];
                mat4.lookAt(lookAtMat4, cameraVecs.cameraVec3, cameraVecs.lookAtVec3, [0,0,1]);

                var perspectiveMatrix = [];
                mat4.perspective(perspectiveMatrix, 45.0, this.canvas.width / this.canvas.height, 1, 1000  );

                if (!this.isShadersLoaded) return;

                this.glClearScreen(gl);
                gl.activeTexture(gl.TEXTURE0);

                this.currentShaderProgram = this.wmoShader;
                gl.useProgram(this.currentShaderProgram.program);

                gl.uniformMatrix4fv(this.currentShaderProgram.lookAtMatrix, false, lookAtMat4);
                gl.uniformMatrix4fv(this.currentShaderProgram.projectionMatrix, false, perspectiveMatrix);

                this.stats.begin();
                var i;
                for (i = 0; i < this.sceneObjectList.length; i ++) {
                    var sceneObject = this.sceneObjectList[i];
                    sceneObject.draw(deltaTime);
                }
                this.stats.end();

                return cameraVecs;
            },
            loadWMOMap : function(filename){
                var wmoObject = new wmoObjectFactory(this.sceneApi);
                wmoObject.load(filename, 0);

                this.sceneObjectList = [wmoObject];
            }
        };

        return Scene;
    }]);
})(window, jQuery);