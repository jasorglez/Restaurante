

// This file can be replaced during build by using the `fileReplacements` array.
// `ng build --prod` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

export const environment = {
  firebase: {
    projectId: 'beapp-501d1',
    appId: '1:151993360357:web:127db5b6d20896fb84990c',
    //aqui juego con las base de datos
    databaseURL: 'https://beapp-501d1-default-rtdb.firebaseio.com',
    // databaseURL: 'https://beapp-testing-b89.firebaseio.com/',
    storageBucket: 'beapp-501d1.appspot.com',
    locationId: 'us-central',
    apiKey: 'AIzaSyDxCBGKk8nT09hdW85-PyOkhw5_JPZLF1A',
    authDomain: 'beapp-501d1.firebaseapp.com',
    messagingSenderId: '151993360357',
    production: false,
  },

  production: false,
  companyId: 47,
  //aqui juego con las base de datos
  urlFirebase: 'https://beapp-501d1-default-rtdb.firebaseio.com/',

  urlAzure: 'https://bi24.azurewebsites.net/',

  // urlSecurity   : 'https://bi2.centralus.cloudapp.azure.com/api',
  // urlSmp        : 'https://bi2.centralus.cloudapp.azure.com/smp/api',
  // urlBpi        : 'https://bi2.centralus.cloudapp.azure.com/bpi/api',
  // urlWarehouse  : 'https://bi2.centralus.cloudapp.azure.com/warehouse/api',


  urlSecurity: 'https://endpoints.biapp.com.mx/api', // 5003
  //urlSecurity     : 'http://localhost:5260/api',

  urlSmp: 'https://endpoints.biapp.com.mx/smp/api', // 5004
  //urlSmp          : 'http://localhost:5183/api',

  urlBpi: 'https://endpoints.biapp.com.mx/bpi/api', // 5005

  urlWarehouse: 'https://endpoints.biapp.com.mx/warehouse/api', // 5007
  //urlWarehouse: 'http://localhost:5199/api',

  urlAdministration: 'https://endpoints.biapp.com.mx/administration/api', // 5006
  //urlAdministration : 'http://localhost:5047/api', // 5006

  urlNotifications: 'https://endpoints.biapp.com.mx/notifications/api', // 5011 -- NotificationsTelegram
  //urlNotifications: 'http://localhost:5011/api',

  urlChatBot: 'https://endpoints.biapp.com.mx/telegram/api',
  //urlChatBot: 'http://localhost:5232/api',

  urlMantenimiento: 'https://endpoints.biapp.com.mx/maintenance/api',

  root: 'root@bi2.mx',
  demo: { email: 'demo@bi2.mx', password: '123456' },

  //  urlAzure    : 'https://localhost:7089/',

  googleDriveCredentials: {
    client_email: 'jsorglez@gmail.com',
    private_key: '	9bb18cadc7bbafd5bd7fb4c2cea3ffb503b0900a',
  },

  urlLogin:
    'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=AIzaSyDxCBGKk8nT09hdW85-PyOkhw5_JPZLF1A',

  urlGetUser:
    'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=AIzaSyDxCBGKk8nT09hdW85-PyOkhw5_JPZLF1A',

  urlFiles: 'gs://beapp-501d1.appspot.com',

  urlProfile: './assets/img/profile.png',

  adminFiles:
    'http://localhost/sistemas-angular/marketplace/src/assets/img/index.php?key=AIzaSyDxCBGKk8nT09hdW85-PyOkhw5_JPZLF1A',

  deleteFiles:
    'http://localhost/sistemas-angular/marketplace/src/assets/img/delete.php?key=AIzaSyDxCBGKk8nT09hdW85-PyOkhw5_JPZLF1A',

  urlRefreshToken:
    'https://securetoken.googleapis.com/v1/token?key=AIzaSyDxCBGKk8nT09hdW85-PyOkhw5_JPZLF1A',

  mercadoPago: {
    // Produccion (ACTIVO)
    publicKey: 'APP_USR-ffba3d82-7423-4dbc-9012-4ca0571dae19', //Produccion
    // Pruebas (descomenta esta linea y comenta la de Produccion para cambiar manualmente)
    // publicKey: 'TEST-4399133a-4676-42a2-ab85-d946370bf96a',
  },

  geminiApiKey: 'YOUR_GROQ_API_KEY_HERE',
  gnewsApiKey: '94ccc596b4dfebc3f72683b6e81d81bc',

  version: '1.74 (03 Julio 2026) Iconos duotono más atractivos en el Menú Principal',
}; 
