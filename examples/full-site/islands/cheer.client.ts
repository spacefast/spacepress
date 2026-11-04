// The browser half of the cheer island: an Interactivity API store that calls the app's `cheer` action.
import { getConfig, getContext, store } from "@wordpress/interactivity";

interface CheerContext { noteId: number; count: number; busy?: boolean }
interface CheerConfig { actions: { cheer: string }; nonce: string }

store("fullsite/cheer", {
  actions: {
    *cheer() {
      const context = getContext<CheerContext>();
      const config = getConfig<CheerConfig>("fullsite/cheer");
      context.busy = true;
      try {
        const response: Response = yield fetch(config.actions.cheer, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json", "x-wp-nonce": config.nonce },
          body: JSON.stringify({ noteId: context.noteId }),
        });
        const result: { data?: { count: number } } = yield response.json();
        if (response.ok && result.data) context.count = result.data.count;
      } finally {
        context.busy = false;
      }
    },
  },
});
