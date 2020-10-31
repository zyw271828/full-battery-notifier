/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

/* exported init */

'use strict';

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Main = imports.ui.main;
const MessageTray = imports.ui.messageTray;
const PowerIndicator = Main.panel.statusArea.aggregateMenu._power;
const UPower = imports.gi.UPowerGlib;

const INDICATOR_ICON = 'battery-full-charged-symbolic';
const THRESHOLD = 80;

let _notifSource = null;
let signals = [];
let data_method = "native";
let notification = null;


class Extension {
    constructor() {
    }

    enable() {
        log(`enabling ${Me.metadata.name} version ${Me.metadata.version}`);
        if ("GetDevicesSync" in PowerIndicator._proxy) {
            data_method = "device";
        } else {
            data_method = "native";
        }

        signals.push([
            PowerIndicator._proxy,
            PowerIndicator._proxy.connect('g-properties-changed', _update),
        ]);
    }

    disable() {
        log(`disabling ${Me.metadata.name} version ${Me.metadata.version}`);
        while (signals.length > 0) {
            let [obj, sig] = signals.pop();
            obj.disconnect(sig);
        }
    }
}

function _initNotifSource() {
    if (!_notifSource) {
        _notifSource = new MessageTray.Source('FullBatteryIndicator', INDICATOR_ICON);
        _notifSource.connect('destroy', function () {
            _notifSource = null;
        });
        Main.messageTray.add(_notifSource);
    }
}

function _showNotification(message, urgent) {
    _initNotifSource();

    if (_notifSource.count === 0) {
        notification = new MessageTray.Notification(_notifSource, message);
    } else {
        notification = _notifSource.notifications[0];
        notification.update(message, '', { clear: true });
    }

    if (urgent) {
        notification.setUrgency(MessageTray.Urgency.CRITICAL);
    } else {
        notification.setUrgency(MessageTray.Urgency.NORMAL);
    }

    // notification.setTransient(true);
    _notifSource.showNotification(notification);
}

function _hideNotification() {
    if (notification) {
        notification.destroy(MessageTray.NotificationDestroyedReason.SOURCE_CLOSED);
        notification = null;
    }
}

function read_battery() {
    switch (data_method) {
        default:
        case "native":
            return [PowerIndicator._proxy.TimeToEmpty,
            PowerIndicator._proxy.TimeToFull,
            PowerIndicator._proxy.Percentage,
            PowerIndicator._proxy.IsPresent,
            PowerIndicator._proxy.State];
        case "device":
            let devices = PowerIndicator._proxy.GetDevicesSync();
            let n_devs = 0;
            let is_present = false;
            let tte_s = 0;
            let ttf_s = 0;
            let per_c = 0;
            let out_state = UPower.DeviceState.EMPTY;

            for (let i = 0; i < devices.length; ++i) {
                for (let j = 0; j < devices[i].length; ++j) {
                    let [id, type, icon, percent, state, time] = devices[i][j];

                    if (type != UPower.DeviceKind.BATTERY) {
                        continue;
                    }

                    ++n_devs;

                    is_present = true;
                    tte_s += time;
                    ttf_s = tte_s;
                    // Round the total percentage for multiple batteries
                    per_c = ((per_c * (n_devs - 1)) + percent) / n_devs;

                    // charging > discharging > full > empty
                    // Ignore the other states.

                    switch (state) {
                        case UPower.DeviceState.DISCHARGING:
                        case UPower.DeviceState.PENDING_DISCHARGE:
                            if (out_state != UPower.DeviceState.CHARGING) {
                                out_state = UPower.DeviceState.DISCHARGING;
                            }
                            break;
                        case UPower.DeviceState.CHARGING:
                        case UPower.DeviceState.PENDING_CHARGE:
                            out_state = UPower.DeviceState.CHARGING;
                            break;
                        case UPower.DeviceState.FULLY_CHARGED:
                            if (out_state != UPower.DeviceState.CHARGING
                                && out_state != UPower.DeviceState.DISCHARGING) {
                                out_state = UPower.DeviceState.FULLY_CHARGED;
                            }
                            break;
                        default:
                            break;
                    }
                }
            }

            return [tte_s, ttf_s, per_c, is_present, out_state];
    }
}

function _update() {
    let [tte_s, ttf_s, per_c, is_present, state] = read_battery();

    /*
    CHARGING          : 1
    DISCHARGING       : 2
    FULLY_CHARGED     : 4
    PENDING_CHARGE    : 5
    PENDING_DISCHARGE : 6
    */

    if (state == UPower.DeviceState.FULLY_CHARGED || per_c == 100) {
        _showNotification(_('Battery fully charged.'), true);
    } else if (state == UPower.DeviceState.CHARGING && per_c >= THRESHOLD) {
        _showNotification(_('Battery has reached %d%%.').format(per_c));
    } else {
        _hideNotification();
    }
}

function init() {
    log(`initializing ${Me.metadata.name} version ${Me.metadata.version}`);
    return new Extension();
}
