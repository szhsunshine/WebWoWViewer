/**
 * Created by Deamon on 28/01/2015.
 */
/**
 * Created by Deamon on 27/01/2015.
 */
(function (window, $, undefined) {

    var wdtLoader = angular.module('main.services.wdtLoader', ['main.services.chunkedLoader']);

    wdtLoader.factory('wdtLoader', ['chunkedLoader', "$q", "$log", function (chunkedLoader, $q, $log) {
        return function(wdtFilePath) {
            var deferred = $q.defer();

            var promise = chunkedLoader(wdtFilePath)
            promise.then(function(chunkedFile){

                /* First chunk in file has to be MVER */
                var chunk = chunkedFile.loadChunkAtOffset(0);
                if (chunk.chunkIdent !== "MVER") {
                    throw "Got bad WDT file " + wdtFilePath;
                }

                chunk = chunkedFile.loadChunkAtOffset(chunk.nextChunkOffset);
                var wdtObj = {};
                while (chunk.chunkIdent != "") {
                    switch (chunk.chunkIdent) {
                        case "MAIN":
                            var chunkOffs = 0;
                            var tileTable = {};


                            for (var i =0; i < 64; i++) {
                                var tile = {};

                                for (var j = 0; j < 64; j++ ) {
                                    tile[j] = chunk.readInt32(chunkOffs);
                                    chunkOffs+=4; // skip next 4 bytes. They are plain zeros
                                }
                                tileTable[i] = tile;
                            }
                            break;
                        case "MPHD":
                            wdtObj.isWMOMap = chunk.readUint8(0) & 1 > 0;
                            break;

                        case "MWMO":
                            wdtObj.wmoName = wdtObj.readString(0);
                            break;

                        case "MODF":

                            break;

                        default:
                            $log.info("Unknown Chunk. Ident = " + chunk.chunkIdent+", file = "+wdtFilePath);
                    }
                    chunk = chunkedFile.loadChunkAtOffset(chunk.nextChunkOffset);
                }

                deferred.resolve();
            }, function error(){
                deferred.reject();
            });

            return deferred.promise;
        }
    }]);

})(jQuery, window);
