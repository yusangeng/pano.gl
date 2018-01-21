attribute vec4 a_Pos;
varying vec4 v_Pos;
uniform mat4 u_CamTransMatrix;

void main() {
	v_Pos = a_Pos;
	gl_Position = u_CamTransMatrix * a_Pos;
}
