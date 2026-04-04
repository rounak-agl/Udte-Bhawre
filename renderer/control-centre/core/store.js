// renderer/control-centre/core/store.js

class PFStore {
  constructor(initialState = {}) {
    this.state = initialState;
    this.subscribers = new Map();
  }

  get(key) {
    return this.state[key];
  }

  set(key, value) {
    const prev = this.state[key];
    this.state[key] = value;
    this.notify(key, value, prev);
  }

  update(key, updaterFn) {
    this.set(key, updaterFn(this.state[key]));
  }

  merge(newStateObj) {
    Object.keys(newStateObj).forEach(k => {
      this.set(k, newStateObj[k]);
    });
  }

  subscribe(key, cb) {
    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, new Set());
    }
    this.subscribers.get(key).add(cb);
    
    // Call immediately with current value
    cb(this.state[key], undefined);

    // Return unsubscribe fn
    return () => {
      this.subscribers.get(key).delete(cb);
    };
  }

  notify(key, newVal, prevVal) {
    if (this.subscribers.has(key)) {
      this.subscribers.get(key).forEach(cb => cb(newVal, prevVal));
    }
  }
}

window.PFStore = PFStore;
