import { platformBrowser } from '@angular/platform-browser'

import { AppModule } from './app/app.module'

// No enableProdMode() call: the production build strips development-mode code
// itself, and platform-browser-dynamic (which needed the JIT compiler) is gone.
platformBrowser().bootstrapModule(AppModule)
  .catch(err => console.error(err))
