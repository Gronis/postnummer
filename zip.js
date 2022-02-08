// Tom Robinson
// Kris Kowal

var LOCAL_FILE_HEADER = 0x04034b50;
var CENTRAL_DIRECTORY_FILE_HEADER = 0x02014b50;
var END_OF_CENTRAL_DIRECTORY_RECORD = 0x06054b50;
var MADE_BY_UNIX = 3;     // See http://www.pkware.com/documents/casestudies/APPNOTE.TXT

/* Copyright (C) 1999 Masanao Izumo <iz@onicos.co.jp>
 * Version: 1.0.0.1
 * LastModified: Dec 25 1999
 *
 * Ported to CommonJS by Tom Robinson, 2010
*/

const inflate = function (input) {

    // all of these variables must be reset between runs otherwise we get very strange bugs
    // so we've wrapped the whole thing in a closure which is also the CommonJS API.

    /* constant parameters */
    var WSIZE = 32768;		// Sliding Window size
    var STORED_BLOCK = 0;
    var STATIC_TREES = 1;
    var DYN_TREES    = 2;

    /* for inflate */
    var lbits = 9; 		// bits in base literal/length lookup table
    var dbits = 6; 		// bits in base distance lookup table
    var INBUFSIZ = 32768;	// Input buffer size
    var INBUF_EXTRA = 64;	// Extra buffer

    /* variables (inflate) */
    var slide;
    var wp;			// current position in slide
    var fixed_tl = null;	// inflate static
    var fixed_td;		// inflate static
    var fixed_bl, fixed_bd;	// inflate static
    var bit_buf;		// bit buffer
    var bit_len;		// bits in bit buffer
    var method;
    var eof;
    var copy_leng;
    var copy_dist;
    var tl, td;	// literal/length and distance decoder tables
    var bl, bd;	// number of bits decoded by tl and td

    var inflate_data;
    var inflate_pos;


    /* constant tables (inflate) */
    var MASK_BITS = [
        0x0000,
        0x0001, 0x0003, 0x0007, 0x000f, 0x001f, 0x003f, 0x007f, 0x00ff,
        0x01ff, 0x03ff, 0x07ff, 0x0fff, 0x1fff, 0x3fff, 0x7fff, 0xffff
    ];
    // Tables for deflate from PKZIP's appnote.txt.
    var cplens = [ // Copy lengths for literal codes 257..285
        3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31,
        35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258, 0, 0
    ];
    /* note: see note #13 above about the 258 in this list. */
    var cplext = [ // Extra bits for literal codes 257..285
        0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2,
        3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0, 99, 99
    ]; // 99==invalid
    var cpdist = [ // Copy offsets for distance codes 0..29
        1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
        257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145,
        8193, 12289, 16385, 24577
    ];
    var cpdext = [ // Extra bits for distance codes
        0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6,
        7, 7, 8, 8, 9, 9, 10, 10, 11, 11,
        12, 12, 13, 13
    ];
    var border = [  // Order of the bit length code lengths
        16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15
    ];
    /* objects (inflate) */

    function HuftList() {
        this.next = null;
        this.list = null;
    }

    function HuftNode() {
        this.e = 0; // number of extra bits or operation
        this.b = 0; // number of bits in this code or subcode

        // union
        this.n = 0; // literal, length base, or distance base
        this.t = null; // (HuftNode) pointer to next level of table
    }

    function HuftBuild(b,	// code lengths in bits (all assumed <= BMAX)
                   n,	// number of codes (assumed <= N_MAX)
                   s,	// number of simple-valued codes (0..s-1)
                   d,	// list of base values for non-simple codes
                   e,	// list of extra bits for non-simple codes
                   mm	// maximum lookup bits
               ) {
        this.BMAX = 16;   // maximum bit length of any code
        this.N_MAX = 288; // maximum number of codes in any set
        this.status = 0;	// 0: success, 1: incomplete table, 2: bad input
        this.root = null;	// (HuftList) starting table
        this.m = 0;		// maximum lookup bits, returns actual

    /* Given a list of code lengths and a maximum table size, make a set of
       tables to decode that set of codes.	Return zero on success, one if
       the given code set is incomplete (the tables are still built in this
       case), two if the input is invalid (all zero length codes or an
       oversubscribed set of lengths), and three if not enough memory.
       The code with value 256 is special, and the tables are constructed
       so that no bits beyond that code are fetched when that code is
       decoded. */
        {
        var a;			// counter for codes of length k
        var c = new Array(this.BMAX+1);	// bit length count table
        var el;			// length of EOB code (value 256)
        var f;			// i repeats in table every f entries
        var g;			// maximum code length
        var h;			// table level
        var i;			// counter, current code
        var j;			// counter
        var k;			// number of bits in current code
        var lx = new Array(this.BMAX+1);	// stack of bits per table
        var p;			// pointer into c[], b[], or v[]
        var pidx;		// index of p
        var q;			// (HuftNode) points to current table
        var r = new HuftNode(); // table entry for structure assignment
        var u = new Array(this.BMAX); // HuftNode[BMAX][]  table stack
        var v = new Array(this.N_MAX); // values in order of bit length
        var w;
        var x = new Array(this.BMAX+1);// bit offsets, then code stack
        var xp;			// pointer into x or c
        var y;			// number of dummy codes added
        var z;			// number of entries in current table
        var o;
        var tail;		// (HuftList)

        tail = this.root = null;
        for(i = 0; i < c.length; i++)
            c[i] = 0;
        for(i = 0; i < lx.length; i++)
            lx[i] = 0;
        for(i = 0; i < u.length; i++)
            u[i] = null;
        for(i = 0; i < v.length; i++)
            v[i] = 0;
        for(i = 0; i < x.length; i++)
            x[i] = 0;

        // Generate counts for each bit length
        el = n > 256 ? b[256] : this.BMAX; // set length of EOB code, if any
        p = b; pidx = 0;
        i = n;
        do {
            c[p[pidx]]++;	// assume all entries <= BMAX
            pidx++;
        } while(--i > 0);
        if(c[0] == n) {	// null input--all zero length codes
            this.root = null;
            this.m = 0;
            this.status = 0;
            return;
        }

        // Find minimum and maximum length, bound *m by those
        for(j = 1; j <= this.BMAX; j++)
            if(c[j] != 0)
            break;
        k = j;			// minimum code length
        if(mm < j)
            mm = j;
        for(i = this.BMAX; i != 0; i--)
            if(c[i] != 0)
            break;
        g = i;			// maximum code length
        if(mm > i)
            mm = i;

        // Adjust last length count to fill out codes, if needed
        for(y = 1 << j; j < i; j++, y <<= 1)
            if((y -= c[j]) < 0) {
            this.status = 2;	// bad input: more codes than bits
            this.m = mm;
            return;
            }
        if((y -= c[i]) < 0) {
            this.status = 2;
            this.m = mm;
            return;
        }
        c[i] += y;

        // Generate starting offsets into the value table for each length
        x[1] = j = 0;
        p = c;
        pidx = 1;
        xp = 2;
        while(--i > 0)		// note that i == g from above
            x[xp++] = (j += p[pidx++]);

        // Make a table of values in order of bit lengths
        p = b; pidx = 0;
        i = 0;
        do {
            if((j = p[pidx++]) != 0)
            v[x[j]++] = i;
        } while(++i < n);
        n = x[g];			// set n to length of v

        // Generate the Huffman codes and for each, make the table entries
        x[0] = i = 0;		// first Huffman code is zero
        p = v; pidx = 0;		// grab values in bit order
        h = -1;			// no tables yet--level -1
        w = lx[0] = 0;		// no bits decoded yet
        q = null;			// ditto
        z = 0;			// ditto

        // go through the bit lengths (k already is bits in shortest code)
        for(; k <= g; k++) {
            a = c[k];
            while(a-- > 0) {
            // here i is the Huffman code of length k bits for value p[pidx]
            // make tables up to required level
            while(k > w + lx[1 + h]) {
                w += lx[1 + h]; // add bits already decoded
                h++;

                // compute minimum size table less than or equal to *m bits
                z = (z = g - w) > mm ? mm : z; // upper limit
                if((f = 1 << (j = k - w)) > a + 1) { // try a k-w bit table
                // too few codes for k-w bit table
                f -= a + 1;	// deduct codes from patterns left
                xp = k;
                while(++j < z) { // try smaller tables up to z bits
                    if((f <<= 1) <= c[++xp])
                    break;	// enough codes to use up j bits
                    f -= c[xp];	// else deduct codes from patterns
                }
                }
                if(w + j > el && w < el)
                j = el - w;	// make EOB code end at table
                z = 1 << j;	// table entries for j-bit table
                lx[1 + h] = j; // set table size in stack

                // allocate and link in new table
                q = new Array(z);
                for(o = 0; o < z; o++) {
                q[o] = new HuftNode();
                }

                if(tail == null)
                tail = this.root = new HuftList();
                else
                tail = tail.next = new HuftList();
                tail.next = null;
                tail.list = q;
                u[h] = q;	// table starts after link

                /* connect to last table, if there is one */
                if(h > 0) {
                x[h] = i;		// save pattern for backing up
                r.b = lx[h];	// bits to dump before this table
                r.e = 16 + j;	// bits in this table
                r.t = q;		// pointer to this table
                j = (i & ((1 << w) - 1)) >> (w - lx[h]);
                u[h-1][j].e = r.e;
                u[h-1][j].b = r.b;
                u[h-1][j].n = r.n;
                u[h-1][j].t = r.t;
                }
            }

            // set up table entry in r
            r.b = k - w;
            if(pidx >= n)
                r.e = 99;		// out of values--invalid code
            else if(p[pidx] < s) {
                r.e = (p[pidx] < 256 ? 16 : 15); // 256 is end-of-block code
                r.n = p[pidx++];	// simple code is just the value
            } else {
                r.e = e[p[pidx] - s];	// non-simple--look up in lists
                r.n = d[p[pidx++] - s];
            }

            // fill code-like entries with r //
            f = 1 << (k - w);
            for(j = i >> w; j < z; j += f) {
                q[j].e = r.e;
                q[j].b = r.b;
                q[j].n = r.n;
                q[j].t = r.t;
            }

            // backwards increment the k-bit code i
            for(j = 1 << (k - 1); (i & j) != 0; j >>= 1)
                i ^= j;
            i ^= j;

            // backup over finished tables
            while((i & ((1 << w) - 1)) != x[h]) {
                w -= lx[h];		// don't need to update q
                h--;
            }
            }
        }

        /* return actual size of base table */
        this.m = lx[1];

        /* Return true (1) if we were given an incomplete table */
        this.status = ((y != 0 && g != 1) ? 1 : 0);
        } /* end of constructor */
    }


    /* routines (inflate) */

    function GET_BYTE() {
        if(inflate_data.length == inflate_pos)
        return -1;
        return inflate_data.readUInt8(inflate_pos++);
    }

    function NEEDBITS(n) {
        while(bit_len < n) {
            bit_buf |= GET_BYTE() << bit_len;
            bit_len += 8;
        }
    }

    function GETBITS(n) {
        return bit_buf & MASK_BITS[n];
    }

    function DUMPBITS(n) {
        bit_buf >>= n;
        bit_len -= n;
    }

    function inflate_codes(buff, off, size) {
        /* inflate (decompress) the codes in a deflated (compressed) block.
           Return an error code or zero if it all goes ok. */
        var e;		// table entry flag/number of extra bits
        var t;		// (HuftNode) pointer to table entry
        var n;

        if(size == 0)
          return 0;

        // inflate the coded data
        n = 0;
        for(;;) {			// do until end of block
        NEEDBITS(bl);
        t = tl.list[GETBITS(bl)];
        e = t.e;
        while(e > 16) {
            if(e == 99)
            return -1;
            DUMPBITS(t.b);
            e -= 16;
            NEEDBITS(e);
            t = t.t[GETBITS(e)];
            e = t.e;
        }
        DUMPBITS(t.b);

        if(e == 16) {		// then it's a literal
            wp &= WSIZE - 1;
            buff[off + n++] = slide[wp++] = t.n;
            if(n == size)
            return size;
            continue;
        }

        // exit if end of block
        if(e == 15)
            break;

        // it's an EOB or a length

        // get length of block to copy
        NEEDBITS(e);
        copy_leng = t.n + GETBITS(e);
        DUMPBITS(e);

        // decode distance of block to copy
        NEEDBITS(bd);
        t = td.list[GETBITS(bd)];
        e = t.e;

        while(e > 16) {
            if(e == 99)
            return -1;
            DUMPBITS(t.b);
            e -= 16;
            NEEDBITS(e);
            t = t.t[GETBITS(e)];
            e = t.e;
        }
        DUMPBITS(t.b);
        NEEDBITS(e);
        copy_dist = wp - t.n - GETBITS(e);
        DUMPBITS(e);

        // do the copy
        while(copy_leng > 0 && n < size) {
            copy_leng--;
            copy_dist &= WSIZE - 1;
            wp &= WSIZE - 1;
            buff[off + n++] = slide[wp++]
            = slide[copy_dist++];
        }

        if(n == size)
            return size;
        }

        method = -1; // done
        return n;
    }

    function inflate_stored(buff, off, size) {
        /* "decompress" an inflated type 0 (stored) block. */
        var n;

        // go to byte boundary
        n = bit_len & 7;
        DUMPBITS(n);

        // get the length and its complement
        NEEDBITS(16);
        n = GETBITS(16);
        DUMPBITS(16);
        NEEDBITS(16);
        if(n != ((~bit_buf) & 0xffff))
        return -1;			// error in compressed data
        DUMPBITS(16);

        // read and output the compressed data
        copy_leng = n;

        n = 0;
        while(copy_leng > 0 && n < size) {
        copy_leng--;
        wp &= WSIZE - 1;
        NEEDBITS(8);
        buff[off + n++] = slide[wp++] =
            GETBITS(8);
        DUMPBITS(8);
        }

        if(copy_leng == 0)
          method = -1; // done
        return n;
    }

    function inflate_fixed(buff, off, size) {
        /* decompress an inflated type 1 (fixed Huffman codes) block.  We should
           either replace this with a custom decoder, or at least precompute the
           Huffman tables. */

        // if first time, set up tables for fixed blocks
        if(fixed_tl == null) {
        var i;			// temporary variable
        var l = new Array(288);	// length list for huft_build
        var h;	// HuftBuild

        // literal table
        for(i = 0; i < 144; i++)
            l[i] = 8;
        for(; i < 256; i++)
            l[i] = 9;
        for(; i < 280; i++)
            l[i] = 7;
        for(; i < 288; i++)	// make a complete, but wrong code set
            l[i] = 8;
        fixed_bl = 7;

        h = new HuftBuild(l, 288, 257, cplens, cplext,
                      fixed_bl);
        if(h.status != 0) {
            alert("HufBuild error: "+h.status);
            return -1;
        }
        fixed_tl = h.root;
        fixed_bl = h.m;

        // distance table
        for(i = 0; i < 30; i++)	// make an incomplete code set
            l[i] = 5;
        var fixed_bd = 5;

        h = new HuftBuild(l, 30, 0, cpdist, cpdext, fixed_bd);
        if(h.status > 1) {
            fixed_tl = null;
            alert("HufBuild error: "+h.status);
            return -1;
        }
        fixed_td = h.root;
        fixed_bd = h.m;
        }

        tl = fixed_tl;
        td = fixed_td;
        bl = fixed_bl;
        bd = fixed_bd;
        return inflate_codes(buff, off, size);
    }

    function inflate_dynamic(buff, off, size) {
        // decompress an inflated type 2 (dynamic Huffman codes) block.
        var i;		// temporary variables
        var j;
        var l;		// last length
        var n;		// number of lengths to get
        var t;		// (HuftNode) literal/length code table
        var nb;		// number of bit length codes
        var nl;		// number of literal/length codes
        var nd;		// number of distance codes
        var ll = new Array(286+30); // literal/length and distance code lengths
        var h;		// (HuftBuild)

        for(i = 0; i < ll.length; i++)
        ll[i] = 0;

        // read in table lengths
        NEEDBITS(5);
        nl = 257 + GETBITS(5);	// number of literal/length codes
        DUMPBITS(5);
        NEEDBITS(5);
        nd = 1 + GETBITS(5);	// number of distance codes
        DUMPBITS(5);
        NEEDBITS(4);
        nb = 4 + GETBITS(4);	// number of bit length codes
        DUMPBITS(4);
        if(nl > 286 || nd > 30)
          return -1;		// bad lengths

        // read in bit-length-code lengths
        for(j = 0; j < nb; j++)
        {
        NEEDBITS(3);
        ll[border[j]] = GETBITS(3);
        DUMPBITS(3);
        }
        for(; j < 19; j++)
        ll[border[j]] = 0;

        // build decoding table for trees--single level, 7 bit lookup
        bl = 7;
        h = new HuftBuild(ll, 19, 19, null, null, bl);
        if(h.status != 0)
        return -1;	// incomplete code set

        tl = h.root;
        bl = h.m;

        // read in literal and distance code lengths
        n = nl + nd;
        i = l = 0;
        while(i < n) {
        NEEDBITS(bl);
        t = tl.list[GETBITS(bl)];
        j = t.b;
        DUMPBITS(j);
        j = t.n;
        if(j < 16)		// length of code in bits (0..15)
            ll[i++] = l = j;	// save last length in l
        else if(j == 16) {	// repeat last length 3 to 6 times
            NEEDBITS(2);
            j = 3 + GETBITS(2);
            DUMPBITS(2);
            if(i + j > n)
            return -1;
            while(j-- > 0)
            ll[i++] = l;
        } else if(j == 17) {	// 3 to 10 zero length codes
            NEEDBITS(3);
            j = 3 + GETBITS(3);
            DUMPBITS(3);
            if(i + j > n)
            return -1;
            while(j-- > 0)
            ll[i++] = 0;
            l = 0;
        } else {		// j == 18: 11 to 138 zero length codes
            NEEDBITS(7);
            j = 11 + GETBITS(7);
            DUMPBITS(7);
            if(i + j > n)
            return -1;
            while(j-- > 0)
            ll[i++] = 0;
            l = 0;
        }
        }

        // build the decoding tables for literal/length and distance codes
        bl = lbits;
        h = new HuftBuild(ll, nl, 257, cplens, cplext, bl);
        if(bl == 0)	// no literals or lengths
        h.status = 1;
        if(h.status != 0) {
        if(h.status == 1)
            ;// **incomplete literal tree**
        return -1;		// incomplete code set
        }
        tl = h.root;
        bl = h.m;

        for(i = 0; i < nd; i++)
        ll[i] = ll[i + nl];
        bd = dbits;
        h = new HuftBuild(ll, nd, 0, cpdist, cpdext, bd);
        td = h.root;
        bd = h.m;

        if(bd == 0 && nl > 257) {   // lengths but no distances
        // **incomplete distance tree**
        return -1;
        }

        if(h.status == 1) {
        ;// **incomplete distance tree**
        }
        if(h.status != 0)
        return -1;

        // decompress until an end-of-block code
        return inflate_codes(buff, off, size);
    }

    function inflate_start() {
        var i;

        if(slide == null)
        slide = new Array(2 * WSIZE);
        wp = 0;
        bit_buf = 0;
        bit_len = 0;
        method = -1;
        eof = false;
        copy_leng = copy_dist = 0;
        tl = null;
    }

    function inflate_internal(buff, off, size) {
        // decompress an inflated entry
        var n, i;

        n = 0;
        while(n < size) {
        if(eof && method == -1)
            return n;

        if(copy_leng > 0) {
            if(method != STORED_BLOCK) {
            // STATIC_TREES or DYN_TREES
            while(copy_leng > 0 && n < size) {
                copy_leng--;
                copy_dist &= WSIZE - 1;
                wp &= WSIZE - 1;
                buff[off + n++] = slide[wp++] =
                slide[copy_dist++];
            }
            } else {
            while(copy_leng > 0 && n < size) {
                copy_leng--;
                wp &= WSIZE - 1;
                NEEDBITS(8);
                buff[off + n++] = slide[wp++] = GETBITS(8);
                DUMPBITS(8);
            }
            if(copy_leng == 0)
                method = -1; // done
            }
            if(n == size)
            return n;
        }

        if(method == -1) {

            if(eof)
            break;

            // read in last block bit
            NEEDBITS(1);
            if(GETBITS(1) != 0)
            eof = true;
            DUMPBITS(1);

            // read in block type
            NEEDBITS(2);
            method = GETBITS(2);
            DUMPBITS(2);
            tl = null;
            copy_leng = 0;
        }

        switch(method) {
          case 0: // STORED_BLOCK
            i = inflate_stored(buff, off + n, size - n);
            break;

          case 1: // STATIC_TREES
            if(tl != null)
            i = inflate_codes(buff, off + n, size - n);
            else
            i = inflate_fixed(buff, off + n, size - n);
            break;

          case 2: // DYN_TREES
            if(tl != null)
            i = inflate_codes(buff, off + n, size - n);
            else
            i = inflate_dynamic(buff, off + n, size - n);
            break;

          default: // error
            i = -1;
            break;
        }

        if(i == -1) {
            if(eof)
            return 0;
            return -1;
        }
        n += i;
        }
        return n;
    }

    var inflate = function (bytes) {
        var out, buff;
        var i;

        inflate_start();
        inflate_data = bytes;
        inflate_pos = 0;

        buff = Buffer.alloc(1024);
        out = new Array()
        while((i = inflate_internal(buff, 0, buff.length)) > 0) {
            out = out.concat(...buff.slice(0, i))
        }
        inflate_data = undefined; // G.C.
        return Buffer.from(out)
    }

    return inflate(input);

};

var Reader = exports.Reader = function (data) {
    if (!(this instanceof Reader)){
        return new Reader(data);
    }
	if (Buffer.isBuffer(data)) {
		this._source = new BufferSource(data);
    }
	else {
		throw new Error('data must be a <Buffer> object')
    }
    this._offset = 0;
}

function BufferSource(buffer) {
	this._buffer = buffer;
	this.length = function() {
		return buffer.length;
	}
	this.read = function (start, length) {
		var bytes = this._buffer.slice(start, start+length);
		return bytes;
	}
}

Reader.prototype.length = function () {
	return this._source.length();
}

Reader.prototype.position = function () {
    return this._offset;
}

Reader.prototype.seek = function (offset) {
    this._offset = offset;
}

Reader.prototype.read = function (length) {
	var bytes = this._source.read(this._offset, length);
	this._offset += length;
	return bytes;
}

Reader.prototype.readInteger = function (length, bigEndian) {
    if (bigEndian)
        return bytesToNumberBE(this.read(length));
    else
        return bytesToNumberLE(this.read(length));
}

Reader.prototype.readString = function (length, charset) {
    return this.read(length).toString(charset || "utf8");
}

Reader.prototype.readUncompressed = function (length, method) {
    var compressed = this.read(length);
    var uncompressed = null;
    if (method === 0)
        uncompressed = compressed;
    else if (method === 8)
        uncompressed = inflate(compressed);
    else
        throw new Error("Unknown compression method: " + structure.compression_method);
    return uncompressed;
}

Reader.prototype.readStructure = function () {
    var stream = this;
    var structure = {};

    // local file header signature     4 bytes  (0x04034b50)
    structure.signature = stream.readInteger(4);

    switch (structure.signature) {
        case LOCAL_FILE_HEADER :
            this.readLocalFileHeader(structure);
            break;
        case CENTRAL_DIRECTORY_FILE_HEADER :
            this.readCentralDirectoryFileHeader(structure);
            break;
        case END_OF_CENTRAL_DIRECTORY_RECORD :
            this.readEndOfCentralDirectoryRecord(structure);
            break;
        default:
            throw new Error("Unknown ZIP structure signature: 0x" + structure.signature.toString(16));
    }

    return structure;
}

// ZIP local file header
// Offset   Bytes   Description
// 0        4       Local file header signature = 0x04034b50
// 4        2       Version needed to extract (minimum)
// 6        2       General purpose bit flag
// 8        2       Compression method
// 10       2       File last modification time
// 12       2       File last modification date
// 14       4       CRC-32
// 18       4       Compressed size
// 22       4       Uncompressed size
// 26       2       File name length (n)
// 28       2       Extra field length (m)
// 30       n       File name
// 30+n     m       Extra field
Reader.prototype.readLocalFileHeader = function (structure) {
    var stream = this;
    structure = structure || {};

    if (!structure.signature)
        structure.signature = stream.readInteger(4);    // Local file header signature = 0x04034b50

    if (structure.signature !== LOCAL_FILE_HEADER)
        throw new Error("ZIP local file header signature invalid (expects 0x04034b50, actually 0x" + structure.signature.toString(16) +")");

    structure.version_needed       = stream.readInteger(2);    // Version needed to extract (minimum)
    structure.flags                = stream.readInteger(2);    // General purpose bit flag
    structure.compression_method   = stream.readInteger(2);    // Compression method
    structure.last_mod_file_time   = stream.readInteger(2);    // File last modification time
    structure.last_mod_file_date   = stream.readInteger(2);    // File last modification date
    structure.crc_32               = stream.readInteger(4);    // CRC-32
    structure.compressed_size      = stream.readInteger(4);    // Compressed size
    structure.uncompressed_size    = stream.readInteger(4);    // Uncompressed size
    structure.file_name_length     = stream.readInteger(2);    // File name length (n)
    structure.extra_field_length   = stream.readInteger(2);    // Extra field length (m)

    var n = structure.file_name_length;
    var m = structure.extra_field_length;

    structure.file_name            = stream.readString(n);     // File name
    structure.extra_field          = stream.read(m);           // Extra fieldFile name

    return structure;
}

// ZIP central directory file header
// Offset   Bytes   Description
// 0        4       Central directory file header signature = 0x02014b50
// 4        2       Version made by
// 6        2       Version needed to extract (minimum)
// 8        2       General purpose bit flag
// 10       2       Compression method
// 12       2       File last modification time
// 14       2       File last modification date
// 16       4       CRC-32
// 20       4       Compressed size
// 24       4       Uncompressed size
// 28       2       File name length (n)
// 30       2       Extra field length (m)
// 32       2       File comment length (k)
// 34       2       Disk number where file starts
// 36       2       Internal file attributes
// 38       4       External file attributes
// 42       4       Relative offset of local file header
// 46       n       File name
// 46+n     m       Extra field
// 46+n+m   k       File comment
Reader.prototype.readCentralDirectoryFileHeader = function (structure) {
    var stream = this;
    structure = structure || {};

    if (!structure.signature)
        structure.signature = stream.readInteger(4); // Central directory file header signature = 0x02014b50

    if (structure.signature !== CENTRAL_DIRECTORY_FILE_HEADER)
        throw new Error("ZIP central directory file header signature invalid (expects 0x02014b50, actually 0x" + structure.signature.toString(16) +")");

    structure.version                   = stream.readInteger(2);    // Version made by
    structure.version_needed            = stream.readInteger(2);    // Version needed to extract (minimum)
    structure.flags                     = stream.readInteger(2);    // General purpose bit flag
    structure.compression_method        = stream.readInteger(2);    // Compression method
    structure.last_mod_file_time        = stream.readInteger(2);    // File last modification time
    structure.last_mod_file_date        = stream.readInteger(2);    // File last modification date
    structure.crc_32                    = stream.readInteger(4);    // CRC-32
    structure.compressed_size           = stream.readInteger(4);    // Compressed size
    structure.uncompressed_size         = stream.readInteger(4);    // Uncompressed size
    structure.file_name_length          = stream.readInteger(2);    // File name length (n)
    structure.extra_field_length        = stream.readInteger(2);    // Extra field length (m)
    structure.file_comment_length       = stream.readInteger(2);    // File comment length (k)
    structure.disk_number               = stream.readInteger(2);    // Disk number where file starts
    structure.internal_file_attributes  = stream.readInteger(2);    // Internal file attributes
    structure.external_file_attributes  = stream.readInteger(4);    // External file attributes
    structure.local_file_header_offset  = stream.readInteger(4);    // Relative offset of local file header

    var n = structure.file_name_length;
    var m = structure.extra_field_length;
    var k = structure.file_comment_length;

    structure.file_name                 = stream.readString(n);     // File name
    structure.extra_field               = stream.read(m);           // Extra field
    structure.file_comment              = stream.readString(k);     // File comment
    structure.mode                      = stream.detectChmod(structure.version, structure.external_file_attributes); // chmod

    return structure;
}

Reader.prototype.detectChmod = function(versionMadeBy, externalFileAttributes) {
    var madeBy = versionMadeBy >> 8,
        mode = externalFileAttributes >>> 16,
        chmod = false;

    mode = (mode & 0x1ff);
    if (madeBy === MADE_BY_UNIX && (process.platform === 'darwin' || process.platform === 'linux')) {
        chmod = mode.toString(8);
    }
    return chmod;
}

// finds the end of central directory record
// I'd like to slap whoever thought it was a good idea to put a variable length comment field here
Reader.prototype.locateEndOfCentralDirectoryRecord = function () {
    var length = this.length();
    var minPosition = length - Math.pow(2, 16) - 22;

    var position = length - 22 + 1;
    while (--position) {
        if (position < minPosition)
            throw new Error("Unable to find end of central directory record");

        this.seek(position);
        var possibleSignature = this.readInteger(4);
        if (possibleSignature !== END_OF_CENTRAL_DIRECTORY_RECORD)
            continue;

        this.seek(position + 20);
        var possibleFileCommentLength = this.readInteger(2);
        if (position + 22 + possibleFileCommentLength === length)
            break;
    }

    this.seek(position);
    return position;
};

// ZIP end of central directory record
// Offset   Bytes   Description
// 0        4       End of central directory signature = 0x06054b50
// 4        2       Number of this disk
// 6        2       Disk where central directory starts
// 8        2       Number of central directory records on this disk
// 10       2       Total number of central directory records
// 12       4       Size of central directory (bytes)
// 16       4       Offset of start of central directory, relative to start of archive
// 20       2       ZIP file comment length (n)
// 22       n       ZIP file comment
Reader.prototype.readEndOfCentralDirectoryRecord = function (structure) {
    var stream = this;
    structure = structure || {};

    if (!structure.signature)
        structure.signature = stream.readInteger(4); // End of central directory signature = 0x06054b50

    if (structure.signature !== END_OF_CENTRAL_DIRECTORY_RECORD)
        throw new Error("ZIP end of central directory record signature invalid (expects 0x06054b50, actually 0x" + structure.signature.toString(16) +")");

    structure.disk_number               = stream.readInteger(2);    // Number of this disk
    structure.central_dir_disk_number   = stream.readInteger(2);    // Disk where central directory starts
    structure.central_dir_disk_records  = stream.readInteger(2);    // Number of central directory records on this disk
    structure.central_dir_total_records = stream.readInteger(2);    // Total number of central directory records
    structure.central_dir_size          = stream.readInteger(4);    // Size of central directory (bytes)
    structure.central_dir_offset        = stream.readInteger(4);    // Offset of start of central directory, relative to start of archive
    structure.file_comment_length       = stream.readInteger(2);    // ZIP file comment length (n)

    var n = structure.file_comment_length;

    structure.file_comment              = stream.readString(n);     // ZIP file comment

    return structure;
}

Reader.prototype.readDataDescriptor = function () {
    var stream = this;
    var descriptor = {};

    descriptor.crc_32 = stream.readInteger(4);
    if (descriptor.crc_32 === 0x08074b50)
        descriptor.crc_32 = stream.readInteger(4); // CRC-32

    descriptor.compressed_size          = stream.readInteger(4);    // Compressed size
    descriptor.uncompressed_size        = stream.readInteger(4);    // Uncompressed size

    return descriptor;
}

Reader.prototype.iterator = function () {
    var stream = this;

    // find the end record and read it
    stream.locateEndOfCentralDirectoryRecord();
    var endRecord = stream.readEndOfCentralDirectoryRecord();

    // seek to the beginning of the central directory
    stream.seek(endRecord.central_dir_offset);

    var count = endRecord.central_dir_disk_records;

    return {
        next: function () {
            if ((count--) === 0)
                throw "stop-iteration";

            // read the central directory header
            var centralHeader = stream.readCentralDirectoryFileHeader();

            // save our new position so we can restore it
            var saved = stream.position();

            // seek to the local header and read it
            stream.seek(centralHeader.local_file_header_offset);
            var localHeader = stream.readLocalFileHeader();

			// dont read the content just save the position for later use
			var start = stream.position();

            // seek back to the next central directory header
            stream.seek(saved);

            return new Entry(localHeader, stream, start, centralHeader.compressed_size, centralHeader.compression_method, centralHeader.mode);
        }
    };
};

Reader.prototype.forEach = function (block, context) {
    var iterator = this.iterator();
    var next;
    while (true) {
        try {
            next = iterator.next();
        } catch (exception) {
            if (exception === "stop-iteration")
                break;
            if (exception === "skip-iteration")
                continue;
            throw exception;
        }
        block.call(context, next);
    }
};

Reader.prototype.toObject = function (charset) {
    var object = {};
    this.forEach(function (entry) {
        if (entry.isFile()) {
            var data = entry.getData();
            if (charset)
                data = data.toString(charset);
            object[entry.getName()] = data;
        }
    });
    return object;
};

Reader.prototype.toArray = function () {
    var arr = [];
    this.forEach(function (entry) {
        arr.push(entry)
    });
    return arr;
};

Reader.prototype.close = function (mode, options) {
};

var Entry = exports.Entry = function (header, realStream, start, compressedSize, compressionMethod, mode) {
    this._mode = mode;
    this._header = header;
	this._realStream = realStream;
    this._stream = null;
	this._start = start;
	this._compressedSize = compressedSize;
	this._compressionMethod = compressionMethod;
};

Entry.prototype.getName = function () {
    return this._header.file_name;
};

Entry.prototype.isFile = function () {
    return !this.isDirectory();
};

Entry.prototype.isDirectory = function () {
    return this.getName().slice(-1) === "/";
};

Entry.prototype.lastModified = function () {
    return decodeDateTime(this._header.last_mod_file_date, this._header.last_mod_file_time);
};

Entry.prototype.getData = function () {
	if (this._stream == null) {
		var bookmark = this._realStream.position();
		this._realStream.seek(this._start);
		this._stream = this._realStream.readUncompressed(this._compressedSize, this._compressionMethod);
		this._realStream.seek(bookmark);
	}
    return this._stream;
};

Entry.prototype.getMode = function () {
    return this._mode;
};

var bytesToNumberLE = function (bytes) {
    var acc = 0;
    for (var i = 0; i < bytes.length; i++)
        acc += bytes.readUint8(i) << (8*i);
    return acc;
};

var bytesToNumberBE = function (bytes) {
    var acc = 0;
    for (var i = 0; i < bytes.length; i++)
        acc = (acc << 8) + bytes.readUint8(i);
    return acc;
};

var decodeDateTime = function (date, time) {
    return new Date(
        (date >>> 9) + 1980,
        ((date >>> 5) & 15) - 1,
        (date) & 31,
        (time >>> 11) & 31,
        (time >>> 5) & 63,
        (time & 63) * 2
    );
}
