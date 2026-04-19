import redis from './redis.js';

export class CircuitBreaker {
  constructor(name, threshold = 5, resetTimeoutMs = 30000) {
    this.name = `breaker:${name}`;
    this.threshold = threshold;
    this.resetTimeoutMs = resetTimeoutMs;
  }

  async getState() {
    const data = await redis.hgetall(this.name);
    if (!data.state) return { state: 'CLOSED', failures: 0, nextAttempt: 0 };
    return {
      state: data.state,
      failures: parseInt(data.failures, 10),
      nextAttempt: parseInt(data.nextAttempt, 10)
    };
  }

  async fire(action) {
    const current = await this.getState();

    if (current.state === 'OPEN') {
      if (Date.now() > current.nextAttempt) {
        // Transition to HALF_OPEN
        await redis.hset(this.name, 'state', 'HALF_OPEN');
      } else {
        throw new Error(`CircuitBreaker [${this.name}] is OPEN. Fast failing request.`);
      }
    }

    try {
      const result = await action();
      await this.success();
      return result;
    } catch (err) {
      await this.fail(current);
      throw err;
    }
  }

  async success() {
    await redis.hset(this.name, { state: 'CLOSED', failures: 0, nextAttempt: 0 });
  }

  async fail(current) {
    const newFailures = current.failures + 1;
    
    if (newFailures >= this.threshold) {
      await redis.hset(this.name, {
        state: 'OPEN',
        failures: newFailures,
        nextAttempt: Date.now() + this.resetTimeoutMs
      });
      console.warn(`🚨 Distributed CircuitBreaker [${this.name}] TRIPPED OPEN! Recovery window: ${this.resetTimeoutMs}ms`);
    } else if (current.state === 'HALF_OPEN') {
      await redis.hset(this.name, {
        state: 'OPEN',
        failures: newFailures,
        nextAttempt: Date.now() + this.resetTimeoutMs
      });
      console.warn(`🚨 Distributed CircuitBreaker [${this.name}] TRIPPED OPEN from HALF_OPEN.`);
    } else {
      await redis.hset(this.name, 'failures', newFailures);
    }
  }
}
