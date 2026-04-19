import Transport from 'winston-transport';

export default class AlertTransport extends Transport {
  constructor(opts) {
    super(opts);
    this.webhookUrl = process.env.ALERT_WEBHOOK_URL;
  }

  log(info, callback) {
    setImmediate(() => {
      this.emit('logged', info);
    });

    if (this.webhookUrl && (info.level === 'error' || info.level === 'crit')) {
      const payload = {
        text: `🚨 *CRITICAL ALERT* [${info.level.toUpperCase()}]: ${info.message}`,
        attachments: [
          {
            fallback: "Error Details",
            color: "#ff0000",
            text: info.stack || JSON.stringify(info)
          }
        ]
      };

      // Fire and forget webhook alert
      fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(err => {
        // Do not crash if alerting fails, just output to console natively
        console.error('Alert transport failed to send webhook:', err.message);
      });
    }

    callback();
  }
}
