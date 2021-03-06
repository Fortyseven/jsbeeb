function hexbyte(value) {
    "use strict";
    return ((value >> 4) & 0xf).toString(16) + (value & 0xf).toString(16); 
}

function hexword(value) {
    "use strict";
    return hexbyte(value>>8) + hexbyte(value & 0xff);
}

function signExtend(val) {
    "use strict";
    return val >= 128 ? val - 256 : val;
}

function Flags() {
    "use strict";
    this.reset = function() {
        this.c = this.z = this.i = this.d = this.v = this.n = false;
    };
    this.debugString = function() {
        return (this.c ? "C" : "c") +
               (this.z ? "Z" : "z") +
               (this.i ? "I" : "i") +
               (this.d ? "D" : "d") +
               (this.v ? "V" : "v") +
               (this.n ? "N" : "n");
    };

    this.asByte = function() {
        var temp = 0x30;
        if (this.c) temp |= 0x01;
        if (this.z) temp |= 0x02;
        if (this.i) temp |= 0x04;
        if (this.d) temp |= 0x08;
        if (this.v) temp |= 0x40;
        if (this.n) temp |= 0x80;
        return temp;
    };

    this.reset();
}

function Cpu6502(dbgr, video, soundChip) {
    "use strict";
    var self = this;
    this.ramBank = new Uint8Array(16);
    this.memstat = [new Uint8Array(256), new Uint8Array(256)];
    this.memlook = [new Uint32Array(256), new Uint32Array(256)];
    this.ramRomOs = new Uint8Array(128 * 1024 + 17 * 16 * 16384);
    this.vis20k = 0;
    this.romOffset = 128 * 1024;
    this.osOffset = this.romOffset + 16 * 16 * 1024;
    this.a = this.x = this.y = this.s = 0;
    this.romsel = 0;
    this.ram_fe30 = 0;
    this.interrupt = 0;
    this.FEslowdown = [true,false,true,true,false,false,true,false];
    // TODO: semi-bplus-style to get swram for exile hardcoded here
    this.swram = [
        true,true,false,false,
        false,false,false,false,
        false,false,false,false,
        true,true,false,false];

    this.romSelect = function(rom) {
        this.ram_fe30 = rom;
        var c;
        this.romsel = ((rom & 15)<<14) + this.romOffset;
        var offset = this.romsel - 0x8000;
        for (c = 128; c < 192; ++c) this.memlook[0][c] = this.memlook[1][c] = offset;
        var swram = this.swram[rom & 15] ? 1 : 2;
        for (c = 128; c < 192; ++c) this.memstat[0][c] = this.memstat[1][c] = swram;
        // TODO: ram4k, ram12k MASTER BPLUS
    };

    // Works for unpaged RAM only (ie stack and zp)
    this.readmemZpStack = function(addr) {
        addr &= 0xffff;
        if (this.debugread) this.debugread(addr);
        return this.ramRomOs[addr];
    };
    this.writememZpStack = function(addr, b) {
        addr &= 0xffff;
        b |= 0;
        if (this.debugwrite) this.debugwrite(addr, b);
        this.ramRomOs[addr] = b;
    };

    // Handy debug function to read a string zero or \n terminated.
    this.readstring = function(addr) {
        var s = "";
        for (;;) {
            var b = this.readmem(addr);
            addr++;
            if (b === 0 || b === 13) break;
            s += String.fromCharCode(b);
        }
        return s;
    };
    
    this.is1MHzAccess = function(addr) {
        addr &= 0xffff;
        return (addr >= 0xfc00 && addr < 0xff00 && (addr < 0xfe00 || this.FEslowdown[(addr>>5) & 7]));
    };

    this.readmem = function(addr) {
        addr &= 0xffff;
        if (this.debugread) this.debugread(addr);
        if (this.memstat[this.vis20k][addr >> 8]) {
            var offset = this.memlook[this.vis20k][addr >> 8];
            return this.ramRomOs[offset + addr];
        }
        //console.log("Peripheral read " + hexword(addr));
        switch (addr & ~0x0003) {
        case 0xfc20: case 0xfc24: case 0xfc28: case 0xfc2c:
        case 0xfc30: case 0xfc34: case 0xfc38: case 0xfc3c:
            // TODO: sid chip (really?);
            break;
        case 0xfc40: case 0xfc44: case 0xfc48: case 0xfc4c:
        case 0xfc50: case 0xfc54: case 0xfc58: case 0xfc5c:
            // TODO: ide
            break;
        case 0xfe00: case 0xfe04: return this.crtc.read(addr);
        case 0xfe08: case 0xfe0c: return this.acia.read(addr);
        case 0xfe18: // TODO adc on master
            break;
        case 0xfe24: case 0xfe28: // TODO 1770 on master
            break;
        case 0xfe34: // TODO acccon on master;
            break;
        case 0xfe40: case 0xfe44: case 0xfe48: case 0xfe4c:
        case 0xfe50: case 0xfe54: case 0xfe58: case 0xfe5c:
            return this.sysvia.read(addr);
        case 0xfe60: case 0xfe64: case 0xfe68: case 0xfe6c:
        case 0xfe70: case 0xfe74: case 0xfe78: case 0xfe7c:
            return this.uservia.read(addr);
        case 0xfe80: case 0xfe84: case 0xfe88: case 0xfe8c:
        case 0xfe90: case 0xfe94: case 0xfe98: case 0xfe9c:
            // TODO if (!master)
            // TODO wd1770 support
            return this.fdc.read(addr);
        case 0xfec0: case 0xfec4: case 0xfec8: case 0xfecc:
        case 0xfed0: case 0xfed4: case 0xfed8: case 0xfedc:
            // if (!master)
            return this.adconverter.read(addr);
        case 0xfee0: case 0xfee4: case 0xfee8: case 0xfeec:
        case 0xfef0: case 0xfef4: case 0xfef8: case 0xfefc:
            return this.tube.read(addr);
        }
        if (addr >= 0xfc00 && addr < 0xfe00) return 0xff;
        return addr >> 8;
    };

    this.writemem = function(addr, b) {
        addr &= 0xffff;
        b |= 0;
        if (this.debugwrite) this.debugwrite(addr, b);
        if (this.memstat[this.vis20k][addr >> 8] === 1) {
            var offset = this.memlook[this.vis20k][addr >> 8];
            this.ramRomOs[offset + addr] = b;
            return;
        }
        if (addr < 0xfc00 || addr >= 0xff00) return;
        //console.log("Peripheral write " + hexword(addr) + " " + hexbyte(b));
        switch (addr & ~0x0003) {
        case 0xfc20: case 0xfc24: case 0xfc28: case 0xfc2c:
        case 0xfc30: case 0xfc34: case 0xfc38: case 0xfc3c:
            // TODO: sid chip (really?);
            break;
        case 0xfc40: case 0xfc44: case 0xfc48: case 0xfc4c:
        case 0xfc50: case 0xfc54: case 0xfc58: case 0xfc5c:
            // TODO: ide
            break;
        case 0xfe00: case 0xfe04: return this.crtc.write(addr, b);
        case 0xfe08: case 0xfe0c: return this.acia.write(addr, b);
        case 0xfe10: case 0xfe14: // TODO serial
            break;
        case 0xfe18: // TODO adc on master
            break;
        case 0xfe20: return this.ula.write(addr, b);
        case 0xfe24: return  this.ula.write(addr, b); // todo if master, 1770
        case 0xfe28: // TODO 1770 on master
            break;
        case 0xfe30:
            this.romSelect(b);
            break;
        case 0xfe34: // TODO accon etc
            break;
        case 0xfe40: case 0xfe44: case 0xfe48: case 0xfe4c:
        case 0xfe50: case 0xfe54: case 0xfe58: case 0xfe5c:
            return this.sysvia.write(addr, b);
        case 0xfe60: case 0xfe64: case 0xfe68: case 0xfe6c:
        case 0xfe70: case 0xfe74: case 0xfe78: case 0xfe7c:
            return this.uservia.write(addr, b);
        case 0xfe80: case 0xfe84: case 0xfe88: case 0xfe8c:
        case 0xfe90: case 0xfe94: case 0xfe98: case 0xfe9c:
            // TODO if (!master)
            // TODO wd1770 support
            return this.fdc.write(addr, b);
        case 0xfec0: case 0xfec4: case 0xfec8: case 0xfecc:
        case 0xfed0: case 0xfed4: case 0xfed8: case 0xfedc:
            // if (!master)
            return this.adconverter.write(addr, b);
        case 0xfee0: case 0xfee4: case 0xfee8: case 0xfeec:
        case 0xfef0: case 0xfef4: case 0xfef8: case 0xfefc:
            return this.tube.write(addr, b);
        }
        // TODO: hardware!
    };

    this.incpc = function() {
        this.pc = (this.pc + 1) & 0xffff;
    };

    this.getb = function() {
        var result = this.readmem(this.pc);
        this.incpc();
        return result;
    };

    this.getw = function() {
        var result = this.readmem(this.pc);
        this.incpc();
        result |= this.readmem(this.pc) << 8;
        this.incpc();
        return result;
    };

    this.checkInt = function() {
        this.takeInt = (this.interrupt && !this.p.i);
    };

    this.checkViaIntOnly = function() {
        this.takeInt = ((this.interrupt & 0x80) && !this.p.i);
    };

    this.loadRom = function(name, offset) {
        console.log("Loading ROM from " + name);
        var request = new XMLHttpRequest();
        request.open("GET", name, false);
        request.overrideMimeType('text/plain; charset=x-user-defined');
        request.send(null);
        var len = request.response.length;
        if (len != 16384 && len != 8192) {
            throw "Broken rom file";
        }
        for (var i = 0; i < len; ++i) {
            this.ramRomOs[offset + i] = request.response.charCodeAt(i) & 0xff;
        }
    };

    this.loadOs = function(os, basic, dfs) {
        this.loadRom(os, this.osOffset);
        this.loadRom(basic, this.romOffset + 15 * 16384);
        this.loadRom(dfs, this.romOffset + 14 * 16384);
    };

    this.reset = function(hard) {
        console.log("Resetting 6502");
        var i;
        if (hard) {
            for (i = 0; i < 16; ++i) this.ramBank[i] = 0;
            for (i = 0; i < 128; ++i) this.memstat[0][i] = this.memstat[1][i] = 1;
            for (i = 128; i < 256; ++i) this.memstat[0][i] = this.memstat[1][i] = 2;
            for (i = 0; i < 128; ++i) this.memlook[0][i] = this.memlook[1][i] = 0;
            /* TODO: Model A support here */
            for (i = 48; i < 128; ++i) this.memlook[1][i] = 16384;
            for (i = 128; i < 192; ++i) this.memlook[0][i] = this.memlook[1][i] = this.romOffset - 0x8000;
            for (i = 192; i < 256; ++i) this.memlook[0][i] = this.memlook[1][i] = this.osOffset - 0xc000;

            for (i = 0xfc; i < 0xff; ++i) this.memstat[0][i] = this.memstat[1][i] = 0;
            this.ram4k = this.ram8k = this.ram12k = this.ram20k = 0;
            this.instructions = generate6502();
            this.disassembler = new Disassemble6502(this);
            this.sysvia = sysvia(this, soundChip);
            this.uservia = uservia(this);
            this.acia = new Acia(this);
            this.fdc = new Fdc(this);
            this.crtc = video.crtc;
            this.ula = video.ula;
            this.adconverter = { read: function() { return 0xff; }, write: function() {}};
            this.tube = { read: function() { return 0xff; }, write: function() {}};
            this.sysvia.reset();
            this.uservia.reset();
        } else {
            console.log("Soft reset");
        }
        this.cycles = 0;
        this.pc = this.readmem(0xfffc) | (this.readmem(0xfffd)<<8);
        this.p = new Flags();
        this.p.i = 1;
        this.nmi = false;
        this.tubecycle = this.tubecycles = 0;
        this.halted = false;
        video.reset(this, this.sysvia);
        if (hard) soundChip.reset();
        // TODO: cpu type support.
        console.log("Starting PC = " + hexword(this.pc));
    };

    this.setzn = function(v) {
        v = v|0;
        this.p.z = !v;
        this.p.n = !!(v & 0x80);
    };

    this.push = function(v) {
        this.writememZpStack(0x100 + this.s, v);
        this.s = (this.s - 1) & 0xff;
    };

    this.pull = function() {
        this.s = (this.s + 1) & 0xff;
        return this.readmemZpStack(0x100 + this.s);
    };

    this.polltime = function(cycles) {
        this.cycles -= cycles;
        this.sysvia.polltime(cycles);
        this.uservia.polltime(cycles);
        this.fdc.polltime(cycles);
        video.polltime(cycles);
        soundChip.advance(cycles);
    };

    this.NMI = function(nmi) {
        this.nmi = !!nmi;
    };

    this.brk = function() {
        var nextByte = this.pc + 1;
        this.push(nextByte >>> 8);
        this.push(nextByte & 0xff);
        var temp = this.p.asByte();
        this.push(temp);
        this.pc = this.readmem(0xfffe) | (this.readmem(0xffff) << 8);
        this.p.i = 1;
        this.takeInt = 0;
    };

    this.branch = function(taken) {
        var offset = signExtend(this.getb());
        if (!taken) {
            this.polltime(1);
            this.checkInt();
            this.polltime(1);
            return;
        }
        var newPc = (this.pc + offset) & 0xffff;
        var pageCrossed = !!((this.pc & 0xff00) ^ (newPc & 0xff00));
        this.pc = newPc;
        this.polltime(pageCrossed ? 3 : 1);
        this.checkInt();
        this.polltime(pageCrossed ? 1 : 2);
    };

    function adcNonBCD(addend, isC) {
        var result = (self.a + addend + (self.p.c ? 1 : 0));
        self.p.v = !!((self.a ^ result) & (addend ^ result) & 0x80);
        self.p.c = !!(result & 0x100);
        self.a = result & 0xff;
        self.setzn(self.a);
    }

    function adcBCD(addend, isC) {
        var ah = 0;
        var tempb = (self.a + addend + (self.p.c ? 1 : 0)) & 0xff;
        if (!isC && !tempb) self.p.z = true;
        var al = (self.a & 0xf) + (addend & 0xf) + (self.p.c ? 1 : 0);
        if (al > 9) {
            al -= 10;
            al &= 0xf;
            ah = 1;
        }
        ah += (self.a >> 4) + (addend >> 4);
        if (!isC && (ah & 8)) self.p.n = true;
        self.p.v = !((self.a ^ addend) & 0x80) && !!((self.a ^ (ah << 4)) & 0x80);
        self.p.c = false;
        if (ah > 9) {
            self.p.c = true;
            ah -= 10;
            ah &= 0xf;
        }
        self.a = ((al & 0xf) | (ah << 4)) & 0xff;
        if (isC) {
            self.setzn(self.a);
            self.polltime(1);
        }
    }

    function sbcBCD(subend, isC) {
        var hc6 = 0;
        var carry = self.p.c ? 0 : 1;
        self.p.z = self.p.n = false;
        if (((self.a - subend) - carry) !== 0) self.p.z = true;
        var al = (self.a & 0xf) - (subend & 0xf) - carry;
        if (al & 0x10) {
            al = (al - 6) & 0xf;
            hc6 = 1;
        }
        var ah = (self.a >>> 4) - (subend >>> 4);
        if (hc6) ah--;
        if ((self.a - (subend + carry)) & 0x80) self.p.n = true;
        self.p.v = !!((((self.a - (subend + carry)) ^ subend) & 0x80) && ((self.a ^ subend) & 0x80));
        self.p.c = true;
        if (ah & 0x10) {
            self.p.c = false;
            ah = (ah - 6) & 0xf;
        }
        self.a = al | (ah<<4);
    }

    this.adc = function(addend, isC) {
        if (!this.p.d) {
            adcNonBCD(addend, isC);
        } else {
            adcBCD(addend, isC);
        }
    };

    this.sbc = function(subend, isC) {
        if (!this.p.d) {
            adcNonBCD(subend ^ 0xff, isC);
        } else {
            sbcBCD(subend, isC);
        }
    };

    this.execute = function(numCyclesToRun) {
        this.halted = false;
        this.cycles += numCyclesToRun;
        while (!this.halted && this.cycles > 0) {
            this.pc3 = this.oldoldpc;
            this.oldoldpc = this.oldpc;
            this.oldpc = this.pc;
            this.vis20k = this.ramBank[this.pc>>12];
            var opcode = this.readmem(this.pc);
            if (this.debugInstruction && this.oldoldpc !== this.pc && this.debugInstruction(this.pc, opcode)) {
                stop(true);
                return;
            }
            var instruction = this.instructions[opcode];
            if (!instruction) {
                console.log("Invalid opcode " + hexbyte(opcode) + " at " + hexword(this.pc));
                console.log(this.disassembler.disassemble(this.pc)[0]);
                noteEvent('exception', 'invalid opcode', hexbyte(opcode));
                stop(true);
                return;
            }
            this.incpc();
            instruction(this);
            // TODO: timetolive
            if (this.takeInt) {
                this.takeInt = 0;
                this.push(this.pc >>> 8);
                this.push(this.pc & 0xff);
                this.push(this.p.asByte() & ~0x10);
                this.pc = this.readmem(0xfffe) | (this.readmem(0xffff) << 8);
                this.p.i = 1;
                this.polltime(7);
            }
            // TODO: otherstuff
            // TODO: tube
            if (this.nmi) {
                this.push(this.pc >>> 8);
                this.push(this.pc & 0xff);
                this.push(this.p.asByte() & ~0x10);
                this.pc = this.readmem(0xfffa) | (this.readmem(0xfffb) << 8);
                this.p.i = 1;
                this.polltime(7);
                this.nmi = false;
                this.p.d = 0; // TODO this is actually Master only
            }
            // TODO: oldnmi stuff? master only it seems?
        }
    };

    this.stop = function() {
        this.halted = true;
    };

    this.loadOs("/roms/os.rom", "/roms/b/BASIC.ROM", "/roms/b/DFS-0.9.rom");
    this.reset(true);

    dbgr.setCpu(this);
}

