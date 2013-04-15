/*
 * tus-jquery-client
 * https://github.com/tus/tus-jquery-client
 *
 * Copyright (c) 2013 Transloadit Ltd and Contributors
 * http://tus.io/
 *
 * Licensed under the MIT license:
 * http://www.opensource.org/licenses/MIT
 */

(function ($) {
  'use strict';

  // The Public API
  var tus = window.tus = {
    upload: function(file, options) {
      var upload = new ResumableUpload(file, options);
      if (file) {
        upload._start();
      }
      return upload;
    }
  };

  function ResumableUpload(file, options) {
    // The file to upload
    this.file = file;
    // Options for resumable file uploads
    this.options = {
      // The tus upload endpoint url
      endpoint: options.endpoint,

      // @TODO: replace with optionally providing a fingerprint as string
      // if not string, use our own

      // @TODO: second option: resumable: true/false
      // false -> removes resume functionality
      resetBefore: options.resetBefore,
      resetAfter: options.resetAfter
    };

    // The url of the uploaded file, assigned by the tus upload endpoint
    // @TODO rename to fileUrl
    this.url = null;
    // Bytes sent to the server so far
    // @TODO Rename / always call this bytesWritten
    this.bytesUploaded = null;
    // @TODO Add this.bytesTotal again

    // the jqXHR object
    this._jqXHR = null;

    // Create a deferred and make our upload a promise object
    this._deferred = $.Deferred();
    this._deferred.promise(this);
  }

  ResumableUpload.prototype._post = function(url, file, cb) {
    // @TODO stop aligning = signs (it's cute, but distracting without an automated tool like gofmt)
    var self    = this;
    var options = {
      type: 'POST',
      url: url,
      headers: {
        'Content-Range': 'bytes */' + file.size,
        'Content-Disposition': 'attachment; filename="' + encodeURI(file.name) + '"'
      }
    };

    $.ajax(options)
      .fail(function(jqXHR, textStatus, errorThrown) {
        // @todo: Implement retry support
        self._emitFail('Could not post to file resource: ' + textStatus);
      })
      .done(function(data, textStatus, jqXHR) {
        if (!(url = jqXHR.getResponseHeader('Location'))) {
          return self._emitFail('Could not get url for file resource: ' + textStatus);
        }

        cb(url, 0);
      });
  };

  ResumableUpload.prototype._head = function(url, cb) {
    var self    = this;
    // @TODO probably needs cache: false option (and maybe more)
    var options = {
      type: 'HEAD',
      url: url
    };

    console.log('Resuming known url ' + url);

    $.ajax(options)
      .fail(function(jqXHR, textStatus, errorThrown) {
        // @TODO: Implement retry support
        self_emitFail('Could not head at file resource: ' + textStatus);
      })
      .done(function(data, textStatus, jqXHR) {
        var range = jqXHR.getResponseHeader('Range');
        var m     = range && range.match(/bytes=\d+-(\d+)/);
        var bytesUploaded = 0;
        if (m) {
          // If the server has not received anything so far,
          // there will be no Range header present.
          bytesUploaded = parseInt(m[1], 10) + 1;
        }

        cb(url, bytesUploaded);
      });
  };

  // Creates a file resource at the configured tus endpoint and gets the url for it.
  // @TODO Move this to top, I like code being organized in order of execution
  ResumableUpload.prototype._start = function() {
    var self = this;

    // Optionally resetBefore
    if (self.options.resetBefore === true) {
      self._cachedUrl(false);
    }


    // @TODO this belongs in _uploadFile
    var transmit = function (url, bytesUploaded) {
      // Save url
      self.bytesUploaded = bytesUploaded;

      if (self.bytesUploaded === self.file.size) {
        // Cool, we already completely uploaded this
        self._emitProgress(); // <-- update progress to 100%
        return self._emitDone();
      }

      self._cachedUrl(url);
      self._emitProgress();
      // @TODO rename to _uploadFile
      self._upload(url, self.bytesUploaded, self.file.size - 1);
    };

    if (!(self.url = self._cachedUrl())) {
      // @TODO rename to _createFile
      self._post(self.options.endpoint, self.file, transmit);
    } else {
      // @TODO rename to _checkFile
      self._head(self.url, transmit);
    }
  };

  // Uploads the file data to tus resource url created by _start()
  ResumableUpload.prototype._upload = function(url, range_from, range_to) {
    var self  = this;

    var slice = self.file.slice || self.file.webkitSlice || self.file.mozSlice;
    var blob  = slice.call(self.file, range_from, range_to + 1, self.file.type);
    var xhr   = $.ajaxSettings.xhr();

    var options = {
      type: 'PUT',
      url: url,
      data: blob,
      processData: false,
      contentType: self.file.type,
      cache: false,
      xhr: function() {
        return xhr;
      },
      headers: {
        'Content-Range': 'bytes ' + range_from + '-' + range_to  + '/' + self.file.size
      }
    };

    $(xhr.upload).bind('progress', function(e) {
      self.bytesUploaded = e.originalEvent.loaded;
      self._emitProgress(e);
    });

    this._jqXHR = $.ajax(options)
      .fail(function(jqXHR, textStatus, errorThrown) {
        // @TODO: Compile somewhat meaningful error
        // Needs to be cleaned up
        // Needs to have retry
        var msg = jqXHR.responseText || textStatus || errorThrown;
        self._emitFail(msg);
      })
      .done(function() {
        console.log('done', arguments, self, url);

        if (self.options.resetAfter === true) {
          self._cachedUrl(false);
        }

        self._emitDone();
      });
  };

  ResumableUpload.prototype.stop = function() {
    if (this._jqXHR) {
      this._jqXHR.abort();
    }
  };

  ResumableUpload.prototype._emitProgress = function(e) {
    this._deferred.notifyWith(this, [e, this.bytesUploaded, this.file.size]);
  };

  ResumableUpload.prototype._emitDone = function() {
    this._deferred.resolveWith(this, [this.url, this.file]);
  };

  ResumableUpload.prototype._emitFail = function(err) {
    this._deferred.rejectWith(this, [err]);
  };

  ResumableUpload.prototype._cachedUrl = function(url) {
    // @TODO: there is also file.mediaType (or similar, check File Upload Spec) which should
    // be thrown into this as well. The prefix for this should probably be 'tus-' as well
    // (file- is too generic, tus is the vendor)
    // @TODO: Make this a public tus.fingerprint() function on the global API.
    var fingerPrint = 'file-' + this.file.name + '-' + this.file.size;

    if (url === false) {
      console.log('Resetting any known cached url for ' + this.file.name);
      return localStorage.removeItem(fingerPrint);
    }

    if (url) {
      return localStorage.setItem(fingerPrint, url);
    }

    return localStorage.getItem(fingerPrint);
  };
})(jQuery);
