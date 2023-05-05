const fs = require('fs');
const path = require('path');
const glob = require('glob');

const { settings } = require('./settings');

const getFilePathsByPath = (dir) =>
  fs.readdirSync(dir).reduce((files, file) => {
    const name = path.join(dir, file);
    const isDirectory = fs.statSync(name).isDirectory();
    if (isDirectory) return [...files, ...getFilePathsByPath(name)];
    return [...files, name];
  }, []);

const getFilePathsByGlob = (pattern) => {
  const globOptions = {};
  return new Promise((resolve, reject) => {
    glob(pattern, globOptions, function (error, files) {
      if (error) {
        reject(error);
        throw error;
      }
      resolve(files);
    });
  });
};

async function getTestSuitePaths() {
  const isPattern = settings.testSuitesPath.includes('*');
  let fileList;
  if (isPattern) {
    console.log(`Using pattern ${settings.testSuitesPath} to find test suites`);
    fileList = await getFilePathsByGlob(settings.testSuitesPath);
  } else {
    console.log(
      'DEPRECATED: using path is deprecated and will be removed, switch to glob pattern'
    );
    fileList = getFilePathsByPath(settings.testSuitesPath);
  }

  console.log(`${fileList.length} test suite(s) found.`);
  if (settings.isVerbose) {
    console.log('Paths to found suites');
    console.log(JSON.stringify(fileList, null, 2));
  }

  // We can't run more threads than suites
  if (fileList.length < settings.threadCount) {
    console.log(`Thread setting is ${settings.threadCount}, but only ${fileList.length} test suite(s) were found. Adjusting configuration accordingly.`)
    settings.threadCount = fileList.length
  }

  return fileList;
}

function distributeTestsByWeight(testSuitePaths) {
  let specWeights = {};
  try {
    specWeights = JSON.parse(fs.readFileSync(settings.weightsJSON, 'utf8'));
  } catch (err) {
    console.log(`Weight file not found in path: ${settings.weightsJSON}`);
  }

  let map = new Map();
  for (let f of testSuitePaths) {
    let specWeight = settings.defaultWeight;
    Object.keys(specWeights).forEach((spec) => {
      if (f.endsWith(spec)) {
        specWeight = specWeights[spec].weight;
      }
    });
    map.set(f, specWeight);
  }

  map = new Map([...map.entries()].sort((a, b) => b[1] - a[1]));

  const threads = Array.from({ length: settings.threadCount }, () => []);

  for (const [key, weight] of map.entries()) {
    const lightestThread = threads.reduce((lightest, current) => {
      const currentWeight = current.reduce((acc, spec) => acc + map.get(spec.path), 0);
      const lightestWeight = lightest.reduce((acc, spec) => acc + map.get(spec.path), 0);
      return currentWeight < lightestWeight ? current : lightest;
    }, threads[0]);

    lightestThread.push({ path: key, weight });
  }

  // Adding 'list' property to the threads
  return threads.map(thread => ({ list: thread }));
}


module.exports = {
  getTestSuitePaths,
  distributeTestsByWeight
};
