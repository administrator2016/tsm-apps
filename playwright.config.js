const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({

testDir:"tests/e2e",

timeout:60000,

retries:0,

reporter:[
["html"],
["list"]
],

use:{

baseURL:"http://localhost:3000",

headless:true,

ignoreHTTPSErrors:true,

screenshot:"only-on-failure",

video:"retain-on-failure",

trace:"retain-on-failure"

},


});