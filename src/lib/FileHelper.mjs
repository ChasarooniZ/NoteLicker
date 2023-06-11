import { DirectoryPicker } from "./DirectoryPicker.mjs";
import logger from "../logger.mjs";

const FileHelper = {
  BAD_DIRS: ["[data]", "[data] ", "", null],

  removeFileExtension: (name) => {
    let nameArray = name.split(".");
    nameArray.pop();
    return nameArray.join(".");
  },

  /**
   * Read data from a user provided File object
   * @param {File} file           A File object
   * @return {Promise.<String>}   A Promise which resolves to the loaded text data
   */
  readBlobFromFile: (file) => {
    const reader = new FileReader();
    return new Promise((resolve, reject) => {
      reader.onload = () => {
        resolve(reader.result);
      };
      reader.onerror = () => {
        reader.abort();
        reject();
      };
      reader.readAsBinaryString(file);
    });
  },

  download: (content, fileName, contentType) => {
    let a = document.createElement("a");
    let file = new Blob([content], { type: contentType });
    a.href = URL.createObjectURL(file);
    a.download = fileName;
    a.click();
  },

  fileExistsUpdate: (fileList) => {
    const targetFiles = fileList.filter((f) => !CONFIG.NOTELICKER.KNOWN.FILES.has(f));
    for (const file of targetFiles) {
      CONFIG.NOTELICKER.KNOWN.FILES.add(file);
    }
  },

  dirExistsUpdate: (dirList) => {
    const targetFiles = dirList.filter((f) => !CONFIG.NOTELICKER.KNOWN.DIRS.has(f));
    for (const file of targetFiles) {
      CONFIG.NOTELICKER.KNOWN.DIRS.add(file);
    }
  },

  doesDirExist: async (directoryPath) => {
    const dir = DirectoryPicker.parse(directoryPath);
    try {
      await DirectoryPicker.browse(dir.activeSource, dir.current, {
        bucket: dir.bucket,
      });
      return true;
    } catch (error) {
      return false;
    }
  },

  generateCurrentFiles: async (directoryPath) => {
    if (!CONFIG.NOTELICKER.KNOWN.CHECKED_DIRS.has(directoryPath)) {
      logger.debug(`Checking for files in ${directoryPath}...`);
      const dir = DirectoryPicker.parse(directoryPath);
      const fileList = await DirectoryPicker.browse(dir.activeSource, dir.current, {
        bucket: dir.bucket,
      });
      FileHelper.fileExistsUpdate(fileList.files);
      FileHelper.dirExistsUpdate(fileList.dirs);
      // lets do some forge fun because
      if (typeof ForgeVTT !== "undefined" && ForgeVTT?.usingTheForge) {
        if (fileList.bazaar) {
          // eslint-disable-next-line require-atomic-updates
          CONFIG.NOTELICKER.KNOWN.FORGE.TARGETS[directoryPath] = {};
          fileList.files.forEach((file) => {
            const fileName = file.split("/").pop();
            CONFIG.NOTELICKER.KNOWN.FORGE.TARGETS[directoryPath][fileName] = file;
            CONFIG.NOTELICKER.KNOWN.FILES.add(file);
          });
        } else {
          const status = ForgeAPI.lastStatus || (await ForgeAPI.status());
          const userId = status.user;
          // eslint-disable-next-line require-atomic-updates
          CONFIG.NOTELICKER.KNOWN.FORGE.TARGET_URL_PREFIX[directoryPath] = `https://assets.forge-vtt.com/${userId}/${dir.current}`;
        }
      }

      CONFIG.NOTELICKER.KNOWN.CHECKED_DIRS.add(directoryPath);
    } else {
      logger.debug(`Skipping full dir scan for ${directoryPath}...`);
    }
  },

  fileExists: async (directoryPath, filename) => {
    const fileUrl = await FileHelper.getFileUrl(directoryPath, filename);
    let existingFile = CONFIG.NOTELICKER.KNOWN.FILES.has(fileUrl);
    if (existingFile) return true;

    logger.debug(`Checking for ${filename} at ${fileUrl}...`);
    await FileHelper.generateCurrentFiles(directoryPath);

    const filePresent = CONFIG.NOTELICKER.KNOWN.FILES.has(fileUrl);

    if (filePresent) {
      logger.debug(`Found ${fileUrl} after directory scan.`);
    } else {
      logger.debug(`Could not find ${fileUrl}`, {
        directoryPath,
        filename,
        fileUrl,
      });
    }

    return filePresent;
  },

  uploadFile: async function (data, path, filename) {
    const file = new File([data], filename, { type: data.type });
    const result = await DirectoryPicker.uploadToPath(path, file);
    return result;
  },

  uploadImage: async function (data, path, filename) {
    return new Promise((resolve, reject) => {
      FileHelper.uploadFile(data, path, filename)
        .then((result) => {
          resolve(result.path);
        })
        .catch((error) => {
          logger.error("error uploading file: ", error);
          reject(error);
        });
    });
  },

  getForgeUrl: async (directoryPath, filename) => {
    let uri;
    if (!CONFIG.NOTELICKER.KNOWN.CHECKED_DIRS.has(directoryPath)) {
      await FileHelper.generateCurrentFiles(directoryPath);
    }
    const prefix = CONFIG.NOTELICKER.KNOWN.FORGE.TARGET_URL_PREFIX[directoryPath];
    const bazaarTargetPath = CONFIG.NOTELICKER.KNOWN.FORGE.TARGETS[directoryPath];
    const bazaarTarget = bazaarTargetPath ? bazaarTargetPath[filename] : undefined;
    if (bazaarTarget) {
      uri = bazaarTarget;
    } else if (prefix) {
      uri = `${prefix}/${filename}`;
    } else {
      // we can't find the directory path for some reason, final fallback, try and guess the url
      const dir = DirectoryPicker.parse(directoryPath);
      if (dir.activeSource == "data") {
        // Local on-server file system
        uri = `https://assets.forge-vtt.com/bazaar/${dir.current}/${filename}`;
      } else if (dir.activeSource == "forgevtt") {
        const status = ForgeAPI.lastStatus || (await ForgeAPI.status());
        const userId = status.user;
        uri = `https://assets.forge-vtt.com/${userId}/${dir.current}/${filename}`;
      }
    }
    return uri;
  },

  getFileUrl: async (directoryPath, filename) => {
    let uri;
    try {
      if (typeof ForgeVTT !== "undefined" && ForgeVTT?.usingTheForge) {
        uri = await FileHelper.getForgeUrl(directoryPath, filename);
        return uri;
      } else {
        const dir = DirectoryPicker.parse(directoryPath);
        if (dir.activeSource == "data") {
          // Local on-server file system
          uri = dir.current + "/" + filename;
        } else if (dir.activeSource == "forgevtt") {
          const status = ForgeAPI.lastStatus || (await ForgeAPI.status());
          const userId = status.user;
          uri = `https://assets.forge-vtt.com/${userId}/${dir.current}/${filename}`;
        } else if (dir.activeSource == "s3") {
          // S3 Bucket
          uri = `https://${dir.bucket}.${game.data.files.s3.endpoint.hostname}/${dir.current}/${filename}`;
        } else {
          logger.error("DDB Importer cannot handle files stored in that location", dir);
        }
      }
    } catch (exception) {
      throw new Error(
        'Unable to determine file URL for directoryPath"' + directoryPath + '" and filename"' + filename + '"'
      );
    }
    return encodeURI(uri);
  },

};

export default FileHelper;
